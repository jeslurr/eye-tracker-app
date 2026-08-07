# Running the app

Three processes. Two are required, one is optional.

| # | Process | Port | Required? |
|---|---|---|---|
| 1 | Backend — Express + Socket.IO + MongoDB | 4000 | **Yes** |
| 2 | Frontend — Vite dev server | 5173 | **Yes** |
| 3 | Gaze service — Python + MediaPipe | 8765 | Optional |

**Yes, you need the backend.** The game calls `POST /api/games/session` before the
first round and cannot start without it, and login/dashboard go through it too.

The gaze service is genuinely optional — the frontend falls back to WebGazer
(in-browser) when it isn't running. Run it when you want the better accuracy.

Database: this project points at **MongoDB Atlas** (see `MONGO_URI` in
`backend/.env`), so there is nothing to install locally.

---

## One-time setup

```powershell
# Backend
cd backend
npm install
npm run seed          # creates parent@example.com / password

# Frontend
cd ..\frontend
npm install

# Gaze service (optional)
cd ..\eye-tracking
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`npm run seed` is safe to re-run — it prints `already seeded` and changes nothing.

---

## Every time you run it

Open a terminal per process, in this order.

**Terminal 1 — gaze service** (skip if you don't want it)

```powershell
cd eye-tracking
.\run.ps1
```

Wait for `[gaze] listening on ws://127.0.0.1:8765`. MediaPipe's first inference
loads the model, so give it 10-20 seconds before it reports ready.

Start this **before** the browser. The frontend probes for it once when the
calibration screen opens; start it late and that session silently uses WebGazer
instead.

**Terminal 2 — backend**

```powershell
cd backend
npm run dev
```

Wait for `[db] connected`.

**Terminal 3 — frontend**

```powershell
cd frontend
npm run dev
```

Open http://localhost:5173

---

## Using it

1. Log in as `parent@example.com` / `password`
2. Click **Play** on a child (Sam or Aria)
3. Allow camera access when the browser asks
4. **Calibrate** — tap each of the 9 dots and keep looking at it while it fills

   Let your head move naturally. Do **not** hold still: head pose is one of the
   inputs to the fit, and an input that never varies teaches it nothing. A rigid
   calibration falls apart the moment you shift in your seat.

5. Play. The gaze dot shows where the tracker thinks you're looking.

Calibration is saved to `eye-tracking/data/calibration.json` and reloaded on the
next start, so step 4 is once per device — until you move the browser window
(see below).

---

## Which tracker am I actually using?

The calibration screen says *"Using the local eye-tracking service"* when the
Python service is connected. Otherwise it's WebGazer.

To remove the guesswork, pin it in `frontend/.env`:

```
VITE_GAZE_SOURCE=python     # fail loudly instead of falling back
VITE_GAZE_SOURCE=webgazer   # never use the service
VITE_GAZE_SOURCE=auto       # default: service if present, else WebGazer
```

Restart `npm run dev` after editing `.env` — Vite only reads it at startup.

---

## Troubleshooting

**"Could not open camera index 0"** — something else holds the webcam. Close
Teams/Zoom/other browser tabs, or run `.\run.ps1 -Camera 1`.

Note the gaze service and the browser cannot share a camera on Windows. If
you're running the Python service, WebGazer must not also be starting up. With
`VITE_GAZE_SOURCE=auto` that is handled for you.

**Game won't start / spinner on "Getting things ready"** — backend is down or
Atlas is unreachable. Check terminal 2 for `[db] connected`.

**`querySrv ENOTFOUND ...mongodb.net`** — the cluster hostname in `MONGO_URI`
doesn't resolve, which normally means the cluster was deleted, paused, or the
string was copied from the wrong project. Check it against the Atlas UI. To
confirm it's the hostname and not your network:

```powershell
nslookup -type=SRV _mongodb._tcp.<cluster>.<id>.mongodb.net 8.8.8.8
```

**Atlas connection times out** (resolves, but never connects) — different
problem: your current IP isn't on the cluster's Network Access allowlist.

**`EADDRINUSE :::4000`** — a backend is already running. Find and stop it:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | Stop-Process -Id { $_.OwningProcess } -Force
```

**Gaze is offset in one direction** — recalibrate. Calibration maps into browser
*viewport* coordinates, so moving or resizing the window invalidates it.

**Gaze jumps around** — lighting first. See the fps note below.

**Service prints `warning: 15 fps`** — the webcam is lengthening its exposure in
dim light and halving its frame rate. Add light *in front of* the user, not
behind. At 15 fps a 200ms fixation is only three samples, which is thin for the
detector in `backend/src/services/thresholds.js`.

**Want to see what the tracker sees** — run `.\run.ps1 -Preview` for a window
with landmarks, head pose, and the gaze point.

---

## Checking a piece in isolation

```powershell
cd eye-tracking
.\.venv\Scripts\python.exe selftest.py              # no camera needed
.\.venv\Scripts\python.exe integration_check.py     # against a running service
```

Sit in front of the camera for `integration_check.py`, or its tracker
assertions skip rather than pass.
