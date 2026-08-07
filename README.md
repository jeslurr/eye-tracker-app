# Reading Friend — Eye-Tracker Adaptive Learning

A MERN-stack web app that uses webcam-based gaze tracking to help dyslexic
children learn to read. The system reads behavioral signals (fixation,
regression, jitter, skip) and adapts the UI in real time — highlighting,
splitting, speaking, and simplifying — across four progression levels:
shapes → letters → words → sentences.

See `plan.md` for the full BMAD design.

## Quick start

Prereqs: Node 20+, MongoDB running on `mongodb://127.0.0.1:27017`.

```bash
# backend
cd backend
cp .env.example .env
npm install
npm run seed         # creates parent@example.com / password
npm run dev          # http://localhost:4000

# frontend (in a second terminal)
cd frontend
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```

Sign in as `parent@example.com` / `password`, then click **Play** on a child to
start a calibrated session. Camera permission is required; only gaze
coordinates are persisted — no video.

### Optional: the accurate tracker

`eye-tracking/` is a local Python service (MediaPipe + OpenCV) that replaces
WebGazer with noticeably better gaze accuracy. It runs on the built-in laptop
webcam — no extra hardware.

```powershell
cd eye-tracking
.\run.ps1            # first run creates the venv and installs deps
```

Start it **before** the frontend. The app probes for it on the calibration
screen and falls back to WebGazer automatically when it isn't running, so this
is entirely optional. See [eye-tracking/README.md](eye-tracking/README.md).

## Project layout

```
backend/       Express + Socket.IO + Mongoose
frontend/      Vite + React + Recharts, gaze via Python service or WebGazer
eye-tracking/  Python gaze service — MediaPipe iris tracking over WebSocket
docs/          Source domain docs (provided by user)
prompts/       Original BMAD prompt
plan.md        Full design (system / module / architecture / engine / API / etc.)
```

## Gaze sources

Both produce the same `{ x, y, t }` stream, so everything downstream of
[useGazeTracking.js](frontend/src/hooks/useGazeTracking.js) is identical.

| | WebGazer (built in) | `eye-tracking/` service |
|---|---|---|
| Setup | none | Python 3.9–3.12, one `run.ps1` |
| Model | ridge regression on eye patches | MediaPipe iris + head pose |
| Head movement | drifts badly | compensated by the fit |
| Typical error | ~150–300px | ~60–140px |

Pick one explicitly with `VITE_GAZE_SOURCE=auto|python|webgazer` in
`frontend/.env`.

## Behavior engine (summary)

Live gaze (~30 Hz) → BehaviorAnalyzer (fixation/regression/jitter/skip
detection) → AdaptiveEngine (rule-based action set) → Socket.IO event
`adapt.action` → AdaptiveRenderer mutates the active target.

Defaults from `backend/src/services/thresholds.js` — tune per child.
