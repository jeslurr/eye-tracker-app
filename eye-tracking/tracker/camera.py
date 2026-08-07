"""Threaded webcam capture.

cv2.VideoCapture buffers frames internally. If the consumer is slower than the
camera even briefly, read() starts returning stale frames and gaze lags behind
the eye by hundreds of milliseconds. A grabber thread that keeps only the newest
frame makes that impossible.
"""
import threading
import cv2

from config import CAMERA_INDEX, FRAME_WIDTH, FRAME_HEIGHT, TARGET_FPS


class CameraError(RuntimeError):
    pass


class Camera:
    def __init__(self, index=CAMERA_INDEX, width=FRAME_WIDTH, height=FRAME_HEIGHT, fps=TARGET_FPS):
        self.index = index
        self._width = width
        self._height = height
        self._fps = fps
        self._cap = None
        self._frame = None
        self._seq = 0
        self._lock = threading.Lock()
        self._new_frame = threading.Condition(self._lock)
        self._stop = threading.Event()
        self._thread = None

    def open(self):
        # CAP_DSHOW avoids the ~2s MSMF initialisation stall on Windows.
        backend = cv2.CAP_DSHOW if hasattr(cv2, "CAP_DSHOW") else cv2.CAP_ANY
        cap = cv2.VideoCapture(self.index, backend)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(self.index)
        if not cap.isOpened():
            raise CameraError(
                f"Could not open camera index {self.index}. "
                "Close any other app using the webcam, or set GAZE_CAMERA_INDEX."
            )
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        cap.set(cv2.CAP_PROP_FPS, self._fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap = cap

        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="camera", daemon=True)
        self._thread.start()
        return self

    @property
    def size(self):
        if self._cap is None:
            return self._width, self._height
        return (
            int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or self._width,
            int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or self._height,
        )

    def _loop(self):
        consecutive_failures = 0
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                consecutive_failures += 1
                if consecutive_failures > 60:
                    with self._new_frame:
                        self._frame = None
                        self._new_frame.notify_all()
                    break
                continue
            consecutive_failures = 0
            with self._new_frame:
                self._frame = frame
                self._seq += 1
                self._new_frame.notify_all()

    def read(self, timeout=2.0):
        """Block until a frame newer than the last one returned is available.

        Returns None on timeout or if the capture thread has died.
        """
        with self._new_frame:
            last = getattr(self, "_last_seq", -1)
            if self._seq <= last:
                self._new_frame.wait(timeout)
            if self._seq <= last or self._frame is None:
                return None
            self._last_seq = self._seq
            return self._frame

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def __enter__(self):
        return self.open()

    def __exit__(self, *exc):
        self.close()
        return False
