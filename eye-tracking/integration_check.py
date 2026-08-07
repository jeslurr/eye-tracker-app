"""Connect to a running gaze service and exercise the wire protocol.

Verifies the parts selftest.py cannot: that the camera opens, that MediaPipe
runs at a usable frame rate, and that the WebSocket contract matches what
frontend/src/api/gazeClient.js expects.

    python server.py --port 8799        # in one terminal
    python integration_check.py 8799    # in another

Sit in front of the camera while it runs. Without a face it still checks the
transport, but reports the tracker as unverified rather than passing it.
"""
import asyncio
import json
import sys

import websockets

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
VIEWPORT = {"w": 1280, "h": 720, "dpr": 1}


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' -- ' + detail) if detail else ''}")
    return ok


async def collect(ws, seconds, wanted=None, until_state_not=None):
    """Gather messages for a window, optionally stopping early.

    `wanted` stops on a message type; `until_state_not` stops on the first
    status frame whose state differs from the one given.
    """
    out = []
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            return out
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            return out
        msg = json.loads(raw)
        out.append(msg)
        if wanted and msg.get("type") == wanted:
            return out
        if (
            until_state_not
            and msg.get("type") == "status"
            and msg.get("state") != until_state_not
        ):
            return out


async def main():
    ok = True
    uri = f"ws://127.0.0.1:{PORT}"
    print(f"Transport ({uri})")
    try:
        ws = await asyncio.wait_for(websockets.connect(uri), timeout=5)
    except (OSError, asyncio.TimeoutError) as exc:
        print(f"  [FAIL] could not connect: {exc}")
        print("        is the service running? python server.py --port", PORT)
        return 1

    # `await connect(...)` yields the protocol itself, which is not an async
    # context manager -- only the un-awaited Connect object is.
    try:
        first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        ok &= check("greets with a status frame", first.get("type") == "status", str(first))
        ok &= check(
            "status carries the documented fields",
            {"state", "fps", "calibrated"} <= set(first),
            ", ".join(sorted(first)),
        )
        # MediaPipe's first inference loads the model and blocks the tracker
        # loop, so wait for the service to leave 'starting' before asserting
        # anything about command handling.
        state = first.get("state")
        if state == "starting":
            warm = await collect(ws, 30, wanted=None, until_state_not="starting")
            statuses = [m for m in warm if m.get("type") == "status"]
            state = statuses[-1]["state"] if statuses else state
        ok &= check("service reaches a ready state", state != "starting", f"state={state}")
        ok &= check("camera opened", state != "no_camera", f"state={state}")
        if state in ("no_camera", "starting"):
            print("        another app is holding the webcam, or the index is wrong")
            return 1

        await ws.send(json.dumps({"type": "hello", "viewport": VIEWPORT}))
        await ws.send(json.dumps({"type": "nonsense"}))
        errs = await collect(ws, 3, wanted="error")
        ok &= check(
            "unknown commands are rejected, not ignored",
            any(m.get("type") == "error" for m in errs),
        )
        await ws.send("this is not json")
        errs = await collect(ws, 3, wanted="error")
        ok &= check("malformed frames are rejected", any(m.get("type") == "error" for m in errs))

        print("Tracker")
        await collect(ws, 4)  # let the fps window fill
        await ws.send(json.dumps({"type": "status"}))
        frames = await collect(ws, 4, wanted="status")
        statuses = [m for m in frames if m.get("type") == "status"]
        ok &= check("responds to a status request", bool(statuses))
        if statuses:
            state = statuses[-1]["state"]
            fps = statuses[-1]["fps"]
        else:
            fps = first["fps"]

        face_seen = state in ("uncalibrated", "calibrating", "running")
        if not face_seen:
            print(f"  [SKIP] no face in frame (state={state}) -- sit in view and rerun")
        else:
            ok &= check("face detected", True, f"state={state}")
            ok &= check("frame rate is usable", fps >= 10, f"{fps} fps")

        print("Calibration round-trip")
        if not face_seen:
            print("  [SKIP] needs a face in frame")
        else:
            await ws.send(json.dumps({"type": "calib.begin"}))
            await ws.send(json.dumps({"type": "calib.point", "x": 640, "y": 360}))
            msgs = await collect(ws, 8)
            progress = [m for m in msgs if m.get("type") == "calib.progress"]
            ok &= check("emits calibration progress", bool(progress), f"{len(progress)} frames")
            if progress:
                # Rejected frames also emit progress now, so the final frame is
                # not necessarily the fullest -- take the high-water mark.
                best = max(progress, key=lambda m: m["collected"])
                ok &= check(
                    "progress reaches the sample target",
                    best["collected"] >= best["needed"],
                    f"{best['collected']}/{best['needed']}",
                )
                ok &= check(
                    "every progress frame carries a reason field",
                    all("reason" in m for m in progress),
                )
                rejected = [m for m in progress if m.get("reason")]
                print(
                    f"         ({len(rejected)}/{len(progress)} frames rejected"
                    f"{': ' + ', '.join(sorted({m['reason'] for m in rejected})) if rejected else ''})"
                )
            # Count only gaze frames that arrive *after* the first progress
            # frame. When a calibration is already loaded the service is
            # streaming gaze, and frames sent before it processed calib.begin
            # are still in the receive buffer -- those are in flight, not leaks.
            started = next(
                (i for i, m in enumerate(msgs) if m.get("type") == "calib.progress"), None
            )
            after = msgs[started:] if started is not None else msgs
            leaked = [m for m in after if m.get("type") == "gaze"]
            ok &= check(
                "no gaze leaks out mid-calibration",
                not leaked,
                f"{len(leaked)} gaze frames after calibration began",
            )
            # One point is deliberately too few; the service must say so rather
            # than fit something meaningless.
            await ws.send(json.dumps({"type": "calib.fit"}))
            msgs = await collect(ws, 4, wanted="error")
            ok &= check(
                "refuses to fit from one point",
                any(m.get("type") == "error" for m in msgs),
            )
    finally:
        await ws.close()

    print()
    print("ALL PASS" if ok else "FAILURES ABOVE")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
