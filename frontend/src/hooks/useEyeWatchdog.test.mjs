/**
 * Logic check for the eye watchdog, run without React or a browser.
 *
 * The hook body is a plain state machine over (lastSampleAt, now); this
 * reimplements that stepping so the timing rules can be tested directly.
 * Keep it in sync with useEyeWatchdog.js if the rules change.
 *
 *   node src/hooks/useEyeWatchdog.test.mjs
 */

const LOSS_AFTER_MS = 2500;
const REPEAT_MS = 10_000;
const TICK_MS = 500;

function run({ enabled = true, samples, durationMs, lossAfterMs = LOSS_AFTER_MS, repeatMs = REPEAT_MS }) {
  // samples: (now) => boolean, whether a sample arrives at this instant
  let lastSampleAt = 0;
  let lostSince = null;
  let lastAlert = 0;
  let lost = false;
  const alerts = [];

  for (let now = 0; now <= durationMs; now += TICK_MS) {
    if (samples(now)) lastSampleAt = now;
    if (!enabled) { lost = false; lostSince = null; continue; }
    if (!lastSampleAt) continue;             // never armed

    if (now - lastSampleAt <= lossAfterMs) {
      if (lostSince != null) { lostSince = null; lost = false; }
      continue;
    }
    if (lostSince == null) {
      lostSince = now; lastAlert = now; lost = true; alerts.push(now);
      continue;
    }
    if (now - lastAlert >= repeatMs) { lastAlert = now; alerts.push(now); }
  }
  return { alerts, lost };
}

let ok = true;
const check = (label, pass, detail = '') => {
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`);
  if (!pass) ok = false;
};

console.log('Eye watchdog');

// Samples flow for 5s, then stop for 35s.
let r = run({ samples: (t) => t <= 5000, durationMs: 40_000 });
check('alerts once loss is confirmed', r.alerts.length > 0, `${r.alerts.length} alerts`);
// Must fire as soon as the grace period elapses, not a full repeat cycle later.
check('first alert fires right after the grace period',
  r.alerts[0] >= 5000 + LOSS_AFTER_MS && r.alerts[0] < 5000 + LOSS_AFTER_MS + REPEAT_MS,
  `first at ${r.alerts[0]}ms, sample stopped at 5000ms`);
const gaps = r.alerts.slice(1).map((t, i) => t - r.alerts[i]);
check('repeats every 10s', gaps.every((g) => g === REPEAT_MS), `gaps ${gaps.join(', ')}ms`);

// Continuous samples throughout.
r = run({ samples: () => true, durationMs: 40_000 });
check('silent while eyes are tracked', r.alerts.length === 0, `${r.alerts.length} alerts`);
check('not flagged lost while tracked', r.lost === false);

// Brief blink: samples pause for 1.5s, under the grace period.
r = run({ samples: (t) => !(t > 5000 && t <= 6500), durationMs: 20_000 });
check('a blink does not alert', r.alerts.length === 0, `${r.alerts.length} alerts`);

// Samples return after a long gap.
r = run({ samples: (t) => t <= 5000 || t > 25_000, durationMs: 40_000 });
check('stops alerting once eyes come back',
  r.alerts.every((t) => t <= 25_500) && r.lost === false,
  `last alert ${r.alerts[r.alerts.length - 1]}ms, eyes back at 25000ms`);

// Never armed: no sample ever arrives (calibration skipped / tracking off).
r = run({ samples: () => false, durationMs: 60_000 });
check('never nags when tracking was never active', r.alerts.length === 0,
  `${r.alerts.length} alerts`);

// Disabled (not in the playing phase).
r = run({ enabled: false, samples: (t) => t <= 5000, durationMs: 40_000 });
check('silent outside the playing phase', r.alerts.length === 0, `${r.alerts.length} alerts`);

console.log(ok ? '\nALL PASS' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);
