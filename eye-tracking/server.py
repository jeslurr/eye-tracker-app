import argparse
import asyncio
import json
import queue
import signal
import sys
import threading
import time

import numpy as np
import websockets

import config
from config import MIN_SAMPLE_CONFIDENCE
from tracker import Camera, FaceMesh, Calibrator, OneEuroFilter2D, FeatureExtractor
from tracker.calibration import CalibrationError
from tracker.camera import CameraError

# Below this the fixation detector downstream gets too few samples per window.
LOW_FPS = 20.0
# How often to repeat a persistent detection problem in the console.
DETECT_REPEAT_SEC = 5.0


def log(message):
    """Single output stream for everything the operator reads.

    stdout and stderr buffer independently, so splitting messages between them
    makes the console show events out of order -- "detected again" printing
    before the "not detected" that caused it. flush keeps it immediate when the
    output is piped to a file.
    """
    print(f"[gaze] {message}", flush=True)


STATE_STARTING = "starting"
STATE_NO_CAMERA = "no_camera"
STATE_NO_FACE = "no_face"
STATE_UNCALIBRATED = "uncalibrated"
STATE_CALIBRATING = "calibrating"
STATE_RUNNING = "running"


class GazeService:
    def __init__(self, camera_index, preview=False):
        self.camera_index = camera_index
        self.preview = preview
        self.commands = queue.Queue()
        self.clients = set()
        self.loop = None
        self.viewport = None
        self._stop = threading.Event()
        self._state = STATE_STARTING
        self._fps = 0.0
        self._calibrator = Calibrator()
        self._filter = OneEuroFilter2D()
        self._thread = None
        # True between calib.begin and calib.fit. Without it, an already-loaded
        # model would keep emitting gaze in the gaps between calibration dots.
        self._in_calibration = False
        # Detection logging: current problem, when it started, when last printed.
        self._detect_problem = None
        self._detect_since = 0.0
        self._detect_last_log = 0.0

    # --- outbound ---------------------------------------------------------

    def _emit(self, message):
        """Called from the tracker thread; hands the send to the event loop."""
        if self.loop is None or not self.clients:
            return
        payload = json.dumps(message)
        self.loop.call_soon_threadsafe(self._broadcast, payload)

    def _broadcast(self, payload):
        # Fire-and-forget: a slow client drops frames rather than stalling the
        # tracker. Gaze is only useful fresh, so there is nothing worth queueing.
        websockets.broadcast(self.clients, payload)

    def status_message(self):
        meta = self._calibrator.meta
        return {
            "type": "status",
            "state": self._state,
            "fps": round(self._fps, 1),
            "calibrated": self._calibrator.is_fitted,
            "error_px": meta.get("error_px"),
            "viewport": meta.get("viewport"),
        }

    def _set_state(self, state):
        if state != self._state:
            self._state = state
            self._emit(self.status_message())

    # --- inbound ----------------------------------------------------------

    def submit(self, message):
        self.commands.put(message)

    def _drain_commands(self):
        while True:
            try:
                msg = self.commands.get_nowait()
            except queue.Empty:
                return
            self._handle_command(msg)

    def _handle_command(self, msg):
        kind = msg.get("type")
        if kind == "hello":
            vp = msg.get("viewport") or {}
            self.viewport = {
                "w": int(vp.get("w", 0)),
                "h": int(vp.get("h", 0)),
                "dpr": float(vp.get("dpr", 1)),
            }
        elif kind == "calib.begin":
            self._calibrator.begin()
            self._in_calibration = True
            log("calibration started")
            self._set_state(STATE_CALIBRATING)
        elif kind == "calib.point":
            try:
                idx = self._calibrator.begin_point(msg["x"], msg["y"])
            except (KeyError, TypeError, ValueError):
                self._emit({"type": "error", "message": "calib.point needs numeric x and y"})
                return
            self._set_state(STATE_CALIBRATING)
            self._emit(
                {
                    "type": "calib.progress",
                    "point": idx,
                    "collected": 0,
                    "needed": self._calibrator.samples_per_point,
                    "reason": None,
                }
            )
        elif kind == "status":
            # Status is otherwise only pushed on state change, so fps would stay
            # at its startup value for a client that connects and sits idle.
            self._emit(self.status_message())
        elif kind == "calib.fit":
            self._fit()
        elif kind == "calib.clear":
            self._calibrator.clear()
            self._filter.reset()
            self._in_calibration = False
            self._set_state(STATE_UNCALIBRATED)
        else:
            self._emit({"type": "error", "message": f"unknown command: {kind!r}"})

    def _fit(self):
        try:
            meta = self._calibrator.fit(viewport=self.viewport)
        except CalibrationError as exc:
            self._emit({"type": "error", "message": str(exc)})
            self._in_calibration = False
            self._set_state(STATE_UNCALIBRATED if not self._calibrator.is_fitted else STATE_RUNNING)
            return
        self._in_calibration = False
        try:
            self._calibrator.save()
        except OSError as exc:
            self._emit({"type": "error", "message": f"calibration fitted but not saved: {exc}"})
        log(
            f"calibration fitted: {meta['n_points']} points, "
            f"{meta['n_samples']} samples, ~{meta['error_px']}px typical error"
        )
        self._filter.reset()
        self._emit(
            {
                "type": "calib.done",
                "error_px": meta["error_px"],
                "train_error_px": meta["train_error_px"],
                "points": meta["n_points"],
                "samples": meta["n_samples"],
            }
        )
        self._set_state(STATE_RUNNING)

    # --- detection logging ------------------------------------------------

    def _log_detection(self, face, features, now):
        """Report face/eye detection to the console.

        Edge-triggered plus a slow repeat: at 30fps a per-frame print would
        scroll a thousand lines a minute and bury the messages that matter.
        Only transitions are logged, with a periodic reminder while the problem
        persists so a user who looks away mid-session still sees why it stopped.
        """
        if face is None:
            reason = "no face in view"
        elif features is None:
            reason = "face found but eyes not readable"
        elif features.openness < 0.5:
            reason = "eyes closed"
        elif features.confidence < MIN_SAMPLE_CONFIDENCE:
            reason = f"head turned too far (yaw {features.yaw:+.0f} deg)"
        else:
            reason = None

        if reason is None:
            if self._detect_problem is not None:
                log(f"eyes detected again after {now - self._detect_since:.1f}s")
                self._detect_problem = None
            return

        if reason != self._detect_problem:
            # New problem, or the first frame of one.
            log(f"eyes NOT detected -- {reason}")
            self._detect_problem = reason
            self._detect_since = now
            self._detect_last_log = now
        elif now - self._detect_last_log >= DETECT_REPEAT_SEC:
            log(f"still no eyes -- {reason} ({now - self._detect_since:.0f}s)")
            self._detect_last_log = now

    # --- tracker loop -----------------------------------------------------

    def start(self):
        self._thread = threading.Thread(target=self._run, name="tracker", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def _run(self):
        restored = self._calibrator.load()
        if restored:
            log(
                f"restored calibration: {restored['n_points']} points, "
                f"~{restored['error_px']}px error"
            )
        # Stay in 'starting' until a frame has actually been through MediaPipe.
        # The first process() call loads the model and can block for seconds,
        # during which the loop cannot drain commands -- a client told it was
        # ready would have its calibration commands sit in the queue.
        self._state = STATE_STARTING

        try:
            camera = Camera(index=self.camera_index).open()
        except CameraError as exc:
            log(str(exc))
            self._set_state(STATE_NO_CAMERA)
            return

        mesh = FaceMesh()
        extract = FeatureExtractor()
        frame_times = []
        warned_low_fps = False
        try:
            while not self._stop.is_set():
                self._drain_commands()

                frame = camera.read()
                if frame is None:
                    self._set_state(STATE_NO_CAMERA)
                    continue

                now = time.time()
                frame_times.append(now)
                if len(frame_times) > 30:
                    frame_times.pop(0)
                if len(frame_times) > 1:
                    span = frame_times[-1] - frame_times[0]
                    self._fps = (len(frame_times) - 1) / span if span > 0 else 0.0

                # A webcam in dim light silently doubles its exposure time and
                # halves its frame rate. At 15fps a 200ms fixation is only three
                # samples, which is too few for the dispersion test downstream.
                if not warned_low_fps and len(frame_times) == 30 and self._fps < LOW_FPS:
                    warned_low_fps = True
                    log(
                        f"warning: {self._fps:.0f} fps (want {LOW_FPS:.0f}+). "
                        "The camera is lengthening its exposure -- add light in "
                        "front of the user, not behind."
                    )

                face = mesh.process(frame)
                features = extract(face)
                self._log_detection(face, features, now)

                if self._state == STATE_STARTING:
                    # Model is warm and frames are flowing; commands will now be
                    # drained promptly.
                    self._set_state(
                        STATE_RUNNING if self._calibrator.is_fitted else STATE_UNCALIBRATED
                    )

                if features is None and not self._in_calibration:
                    self._set_state(STATE_NO_FACE)
                    if self.preview:
                        self._draw(frame, None, None, None)
                    continue

                if self._in_calibration:
                    # Runs even when features is None. A dropped frame during
                    # calibration must still produce a progress frame carrying
                    # the reason, or the dot silently stops filling and the user
                    # is stuck staring at a frozen screen.
                    progress = self._calibrator.feed(features)
                    if progress is not None:
                        collected, needed, reason = progress
                        self._emit(
                            {
                                "type": "calib.progress",
                                "point": self._calibrator.point_count - 1,
                                "collected": collected,
                                "needed": needed,
                                "reason": reason,
                            }
                        )
                    if self.preview:
                        self._draw(frame, face, features, None)
                    continue

                point = self._calibrator.predict(features)
                if point is None:
                    self._set_state(STATE_UNCALIBRATED)
                    if self.preview:
                        self._draw(frame, face, features, None)
                    continue

                self._set_state(STATE_RUNNING)
                x, y = self._filter(point[0], point[1], now)
                self._emit(
                    {
                        "type": "gaze",
                        "x": round(x, 1),
                        "y": round(y, 1),
                        "t": int(now * 1000),
                        "conf": round(features.confidence, 2),
                    }
                )
                if self.preview:
                    self._draw(frame, face, features, (x, y))
        finally:
            mesh.close()
            camera.close()
            if self.preview:
                import cv2

                cv2.destroyAllWindows()

    # --- debug preview ----------------------------------------------------

    def _draw(self, frame, face, features, point):
        import cv2

        from tracker.face_mesh import LEFT_EYE, RIGHT_EYE, LEFT_IRIS, RIGHT_IRIS

        view = frame.copy()
        if face is not None:
            for eye, iris in ((LEFT_EYE, LEFT_IRIS), (RIGHT_EYE, RIGHT_IRIS)):
                for key in eye.values():
                    px, py = face.points[key]
                    cv2.circle(view, (int(px), int(py)), 2, (80, 220, 80), -1)
                centre = face.points[iris].mean(axis=0)
                cv2.circle(view, (int(centre[0]), int(centre[1])), 3, (60, 180, 255), -1)

            lines = [
                f"yaw {face.yaw:+.1f}  pitch {face.pitch:+.1f}  roll {face.roll:+.1f}",
                f"fps {self._fps:.1f}  state {self._state}",
            ]
            if features is not None:
                lines.append(
                    f"iris L({features.left_x:+.3f},{features.left_y:+.3f}) "
                    f"R({features.right_x:+.3f},{features.right_y:+.3f}) "
                    f"conf {features.confidence:.2f}"
                )
            if point is not None:
                lines.append(f"gaze -> ({point[0]:.0f}, {point[1]:.0f}) viewport px")
            for i, line in enumerate(lines):
                cv2.putText(
                    view, line, (8, 20 + i * 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA,
                )
        else:
            cv2.putText(
                view, "no face", (8, 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (60, 60, 255), 2, cv2.LINE_AA,
            )

        cv2.imshow("gaze debug", view)
        cv2.waitKey(1)


async def main_async(service, host, port):
    service.loop = asyncio.get_running_loop()

    async def handler(websocket):
        service.clients.add(websocket)
        # Logged because "is the browser actually using this, or has it silently
        # fallen back to WebGazer?" is otherwise unanswerable from the console.
        log(f"client connected ({len(service.clients)} total) -- "
            "the web app is using this service")
        try:
            await websocket.send(json.dumps(service.status_message()))
            async for raw in websocket:
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    await websocket.send(
                        json.dumps({"type": "error", "message": "invalid JSON"})
                    )
                    continue
                if isinstance(message, dict):
                    service.submit(message)
        except websockets.ConnectionClosed:
            pass
        finally:
            service.clients.discard(websocket)
            log(f"client disconnected ({len(service.clients)} remaining)")

    stop_future = asyncio.get_running_loop().create_future()

    def request_stop(*_):
        if not stop_future.done():
            stop_future.set_result(None)

    try:
        signal.signal(signal.SIGINT, request_stop)
        signal.signal(signal.SIGTERM, request_stop)
    except ValueError:
        pass

    async with websockets.serve(handler, host, port, ping_interval=20):
        log(f"listening on ws://{host}:{port}")
        await stop_future
    log("shutting down")


def main():
    parser = argparse.ArgumentParser(description="Webcam gaze service")
    parser.add_argument("--camera", type=int, default=config.CAMERA_INDEX,
                        help="webcam index (default 0)")
    parser.add_argument("--host", default=config.HOST)
    parser.add_argument("--port", type=int, default=config.PORT)
    parser.add_argument("--preview", action="store_true",
                        help="show a debug window with landmarks and gaze")
    args = parser.parse_args()

    np.seterr(all="ignore")
    service = GazeService(camera_index=args.camera, preview=args.preview)
    service.start()
    try:
        asyncio.run(main_async(service, args.host, args.port))
    except KeyboardInterrupt:
        pass
    finally:
        service.stop()


if __name__ == "__main__":
    main()
