# eye-tracking — webcam gaze service

MediaPipe + OpenCV gaze tracking that streams screen coordinates to the frontend
over a WebSocket. Runs on the **built-in laptop webcam** — no special hardware,
no IR camera, no purchase required.

Approach adapted from [JEOresearch/EyeTracker](https://github.com/JEOresearch/EyeTracker)
(`Webcam3DTracker`), with the desktop mouse control removed, 9-point calibration
added, and the output redirected to the browser instead of the OS cursor.

## Requirements

- **Python 3.9–3.12.** MediaPipe publishes no wheels for 3.13+. This machine has
  3.11.9 as the default `python`, which works.
- A webcam. Any one. Lighting matters far more than the camera.

## Setup

```powershell
cd eye-tracking
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run

```powershell
python server.py              # headless, listens on ws://127.0.0.1:8765
python server.py --preview    # plus a debug window: landmarks, head pose, gaze
python server.py --camera 1   # if index 0 is the wrong camera
```

Start it **before** the frontend. The frontend probes for it and silently falls
back to WebGazer when it isn't running, so a missing service looks like "the
tracking got worse" rather than an error.

## How it works

```
webcam ──► Camera          threaded capture, newest-frame-only (no lag buildup)
       ──► FaceMesh        MediaPipe, refine_landmarks=True → 478 pts incl. irises
       ──► extract_features  iris offset per eye, roll-corrected, scale-normalised
                             + head yaw/pitch/roll + interocular distance
       ──► Calibrator      ridge regression on a quadratic expansion → viewport px
       ──► OneEuroFilter2D adaptive smoothing (still at rest, fast on saccades)
       ──► WebSocket       {"type":"gaze","x":…,"y":…,"t":…,"conf":…}
```

Two design decisions worth knowing:

**Regression, not ray-casting.** A pure geometric gaze ray needs real camera
intrinsics and a per-person eyeball radius. Without those it drifts. Feeding
gaze-correlated features into a per-user calibration fit is both more accurate
and more robust on commodity webcams.

**Viewport coordinates, not desktop coordinates.** The service never learns where
the browser window sits. Calibration targets arrive from the browser as viewport
coordinates and the model maps straight into that space, which removes the
conversion entirely. The trade-off: **moving or resizing the browser window
invalidates the calibration.** Recalibrate after either.

## Calibration

Driven from the frontend's calibration screen — tap each of 9 dots and keep
looking at it while it fills. Results are saved to `data/calibration.json` and
reloaded on the next start, so it's a one-time step per device.

The reported accuracy is **leave-one-point-out cross-validation**, not training
error. Training error on a fit this flexible would read ~10px and mean nothing.
Expect roughly **60–140px** on a laptop webcam in decent light.

Reset it by deleting `data/calibration.json`, or from the frontend.

## Accuracy: what to expect

Webcam gaze lands around 2–5° of visual angle — roughly 3–6 cm on screen at
normal sitting distance. That is enough to tell **which of four answer buttons**
a child is looking at. It is *not* enough to tell which letter within a word.
Hit-test at word or box level; the game screens are already built that way.

What actually moves the number:

| Factor | Effect |
|---|---|
| Even, front-facing light | Largest single factor. Avoid backlight and windows behind the user. |
| Head movement *during* calibration | Counter-intuitively **helpful** — see below. |
| Recalibrating per session | Cheap, and meaningfully better than reusing yesterday's fit. |
| Screen size | Same angular error covers a smaller fraction of a large screen. |

### Move your head a little while calibrating

Head pose is compensated by the fit, but only because `yaw` and `pitch` are
columns in the regression — and a column that never varies teaches the model
nothing. Calibrating with the head clamped perfectly still produces a fit that
falls apart the moment the user shifts.

`selftest.py` asserts this in both directions: a fit trained with natural head
movement stays accurate at a head pose it never saw, and a rigid-head fit is
verified to **fail** the same test. Normal fidgeting across nine dots is plenty;
don't ask the child to hold still.

### Measured on this machine

A laptop webcam in ordinary indoor light, 640×480:

| | |
|---|---|
| Camera throughput | ~15 fps (reports 30, delivers 15) |
| MediaPipe inference | 25–100 ms/frame depending on CPU load |
| End-to-end gaze rate | ~14.6 Hz |
| Calibration duration | ~21 s for 9 points |

The camera is the bottleneck, not MediaPipe. Webcams silently double their
exposure time in dim light and halve their frame rate to compensate; this one
would not accept an MJPG mode to avoid it. More light on the *user's face* is
the fix — the service prints a warning below 20 fps.

This matters downstream: at 15 fps the 200 ms fixation window in
`backend/src/services/thresholds.js` holds only three samples. Either add light
or loosen `FIXATION_MIN_MS`.

## Protocol

Client → server:

```json
{"type": "hello",       "viewport": {"w": 1280, "h": 720, "dpr": 1}}
{"type": "status"}
{"type": "calib.begin"}
{"type": "calib.point", "x": 128, "y": 72}
{"type": "calib.fit"}
{"type": "calib.clear"}
```

Status is otherwise only pushed on state change, so `{"type": "status"}`
requests a fresh reading (useful for a live fps display).

Server → client:

```json
{"type": "status",         "state": "running", "fps": 29.4, "calibrated": true, "error_px": 88.0}
{"type": "gaze",           "x": 523.4, "y": 310.2, "t": 1712345678901, "conf": 0.87}
{"type": "calib.progress", "point": 3, "collected": 18, "needed": 30}
{"type": "calib.done",     "error_px": 88.0, "points": 9, "samples": 189}
{"type": "error",          "message": "…"}
```

`state` is one of `starting`, `no_camera`, `no_face`, `uncalibrated`,
`calibrating`, `running`.

## Tests

```powershell
python selftest.py                  # no camera needed
python integration_check.py 8765    # against a running service
```

`selftest.py` fits the calibration model against synthetic samples generated
from known physics, then checks accuracy, head-movement robustness, persistence
round-trip, sample rejection, and filter response. `integration_check.py`
exercises the live WebSocket protocol — sit in front of the camera when running
it, or the tracker assertions skip rather than pass.

## Tuning

Everything in `config.py` reads from an env var. The ones worth touching:

| Var | Default | When to change |
|---|---|---|
| `GAZE_CAMERA_INDEX` | `0` | Wrong camera selected |
| `GAZE_MIN_CUTOFF` | `1.0` | Lower = smoother but laggier |
| `GAZE_BETA` | `0.005` | Higher = keeps up with fast saccades |
| `GAZE_SAMPLES_PER_POINT` | `30` | More = better fit, longer calibration |
| `GAZE_RIDGE_LAMBDA` | `1.0` | Raise if the mapping overshoots at screen edges |

`GAZE_BETA` is far more sensitive than it looks — it is in Hz per (px/s), and
webcam noise alone produces a few hundred px/s of apparent speed. Anything above
~0.05 lets the noise drive the adaptive cutoff and the filter stops filtering
altogether. Measured here: `0.005` gives ~4px jitter at rest with a one-frame
saccade response; `0.35` gave ~11px and no useful smoothing.

## Troubleshooting

**"Could not open camera index 0"** — another app holds the webcam (Teams, Zoom,
a browser tab that already called `getUserMedia`). Close it, or pass `--camera 1`.

**Gaze is offset in one direction** — recalibrate. Usually the window moved.

**Gaze jumps around** — check lighting first, then lower `GAZE_MIN_CUTOFF`.

**Frontend still uses WebGazer** — the service wasn't up when the game screen
mounted. Start it first, then reload. Pin the source with
`VITE_GAZE_SOURCE=python` in `frontend/.env` to see a hard failure instead of a
silent fallback.
