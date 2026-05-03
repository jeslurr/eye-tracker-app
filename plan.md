# Eye-Tracker Adaptive Learning Platform — Master Plan

## 1. System Breakdown

A behavior-driven adaptive learning system for dyslexic children. Webcam-based gaze tracking feeds a real-time decision engine that mutates the UI to scaffold reading.

Pipeline: `Webcam → Gaze Sample → Fixation/Regression/Jitter Detector → Cognitive State → Adaptive Action → UI mutation`.

Levels of progression: Shapes → Letters → 2–3 letter Words → Simple Sentences. Promotion is gated by per-target behavior scores, not just correctness.

## 2. Module Design

| Layer | Module | Responsibility |
|-------|--------|----------------|
| FE | `EyeTracker` | WebGazer init, calibration, gaze stream |
| FE | `AdaptiveRenderer` | Applies highlight/split/audio/simplify ops to current target |
| FE | `GameScreen` | Owns target, hit-test for gaze, score |
| FE | `Dashboard` | Heatmap, difficulty zones, brain-speed, trends |
| BE | `BehaviorAnalysis` | Streaming fixation/regression/jitter/saccade detection |
| BE | `AdaptiveEngine` | Maps cognitive state → action set |
| BE | `BrainSpeed` | Reaction-time + decision-delay classification |
| BE | `GameLogic` | Level/difficulty controller, promotion gates |
| BE | `Reports` | Aggregations for dashboard |
| BE | `Realtime` | Socket.IO gateway for gaze in / actions out |

## 3. Architecture

```
[Webcam] -> WebGazer (FE) -> useGazeTracking hook
   |                              |
   |  ~30Hz gaze samples          v
   |                       Local micro-buffer (200ms) ─┐
   |                              |                    │
   |                              v                    │
   |                    Socket.IO (gaze.sample) ───────┘
   |                              |
   v                              v
[GameScreen state]   [BehaviorAnalysis stream]
        ^                         |
        |                         v
        |              [AdaptiveEngine] -> action
        |                         |
        |        Socket.IO (adapt.action)
        +----- AdaptiveRenderer  <----┘

REST: /api/auth, /api/games, /api/results, /api/dashboard
Persisted: gaze coords (no video), session events, results
```

Frontend processes raw gaze into 200ms windows to keep bandwidth sane (~5 packets/s) and reduce backend CPU. Backend owns the cognitive state machine so scoring/reports are authoritative.

Latency budget: gaze sample → action ≤ 100ms. Most fast-loop adaptations (highlight) can be triggered locally with backend confirming; deep adaptations (level-down, audio) come from server.

## 4. Behavior Engine Logic

Thresholds (tunable per child, defaults from literature):
- `FIXATION_MIN_MS = 200`, `CONFUSION_MS = 1200`
- `REGRESSION_WINDOW = 5 fixations`, `REGRESSION_HIGH = 3`
- `JITTER_STD_PX = 35` over 300ms window
- `SKIP_GAP_MS = 800` with no on-target fixation

Pseudocode:

```
on gazeSample(x, y, t, target):
  push to ring buffer (last 2s)
  if dispersion(buffer.last(200ms)) < FIXATION_DISP:
     extend or open Fixation(target, dur)
     if dur > CONFUSION_MS: emit CONFUSION(target)
  else:
     close fixation; compute saccade
     if saccade.direction == BACKWARD: regressions++
     if regressions in last window > REGRESSION_HIGH: emit DECODING_ISSUE
  if std(buffer.last(300ms)) > JITTER_STD_PX: emit JITTER
  if now - lastOnTargetFixation > SKIP_GAP_MS: emit SKIP

on cognitiveEvent(e):
  CONFUSION         -> HIGHLIGHT_LETTERS
  DECODING_ISSUE    -> SPLIT_WORD + AUDIO
  JITTER            -> SIMPLIFY_UI (increase spacing, reduce contrast competitors)
  SKIP              -> ATTENTION_PROMPT (gentle pulse)
  if 2+ events in 4s: DIFFICULTY_DOWN
  if 0 events for 8s and correct: DIFFICULTY_UP

brainSpeed = classify(reactionTime, decisionDelay):
  RT<800ms & DD<400ms      -> HIGH
  RT<1500ms & DD<900ms     -> MEDIUM
  else                     -> LOW
```

## 5. Database Design (MongoDB)

- `users` — `{_id, role: child|parent|teacher, name, dob, parentId?, prefs}`
- `gameSessions` — `{_id, userId, level, startedAt, endedAt, deviceMeta}`
- `gazeSamples` — `{sessionId, t, x, y, target?}` (TTL 30 days, no video, coords only)
- `behaviorEvents` — `{sessionId, t, type, target, meta}` (CONFUSION, REGRESSION, etc.)
- `adaptActions` — `{sessionId, t, action, target, reason}`
- `gameResults` — `{sessionId, level, correct, total, brainSpeed, scoreByDimension}`
- `reports` — denormalized rollups for dashboard

## 6. API Design

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register` | Create parent/teacher → child |
| POST | `/api/auth/login` | JWT |
| GET  | `/api/games/next` | Recommended level/target list |
| POST | `/api/games/session` | Start session |
| POST | `/api/games/session/:id/end` | End session, finalize result |
| POST | `/api/track` | Bulk gaze samples (fallback to WS) |
| POST | `/api/analyze` | One-shot analysis on a window |
| GET  | `/api/results/:userId` | History |
| GET  | `/api/dashboard/:userId` | Heatmap + trends + brain speed |

Socket events: `gaze.sample`, `gaze.batch`, `adapt.action`, `level.change`, `session.end`.

## 7–8. See `frontend/` and `backend/` source.

## 9. Game Design

Four games, identical adaptive scaffolding:
1. **Shapes** — match shape to slot. Pre-literacy visual training.
2. **Letters** — find the named letter.
3. **Words** (2–3 letter) — read aloud target, pick image.
4. **Sentences** — read short sentence, answer yes/no.

UX: high-contrast palette, OpenDyslexic font, 28pt+ sizing, max 1 target on screen at a time, star rewards, gentle audio, no time pressure visible to child.

## 10. Dashboard Design

For parent/teacher:
- Gaze heatmap per level
- Difficulty zones (per-letter/word confusion frequency)
- Brain-speed trend (Low/Med/High over time)
- Adaptive-action density (what helped most)
- Session timeline

## 11. Plan File

This document.
