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

## Project layout

```
backend/   Express + Socket.IO + Mongoose
frontend/  Vite + React + WebGazer.js + Recharts
docs/      Source domain docs (provided by user)
prompts/   Original BMAD prompt
plan.md    Full design (system / module / architecture / engine / API / etc.)
```

## Behavior engine (summary)

Live gaze (~30 Hz) → BehaviorAnalyzer (fixation/regression/jitter/skip
detection) → AdaptiveEngine (rule-based action set) → Socket.IO event
`adapt.action` → AdaptiveRenderer mutates the active target.

Defaults from `backend/src/services/thresholds.js` — tune per child.
