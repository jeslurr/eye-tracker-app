import { THRESHOLDS as T } from './thresholds.js';

function dispersion(samples) {
  if (samples.length < 2) return 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of samples) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

function stddev(samples) {
  if (samples.length < 2) return 0;
  let mx = 0, my = 0;
  for (const s of samples) { mx += s.x; my += s.y; }
  mx /= samples.length; my /= samples.length;
  let sx = 0, sy = 0;
  for (const s of samples) { sx += (s.x - mx) ** 2; sy += (s.y - my) ** 2; }
  return Math.sqrt((sx + sy) / samples.length);
}

export class BehaviorAnalyzer {
  constructor(onEvent) {
    this.buffer = [];
    this.openFixation = null;
    this.recentSaccades = [];
    this.lastOnTargetT = 0;
    this.eventTimes = [];
    this.fixationsClosed = [];
    this.regressionsRecent = [];
    this.onEvent = onEvent;
  }

  emit(type, target, meta = {}) {
    const t = meta.t ?? Date.now();
    this.eventTimes.push({ type, t });
    this.eventTimes = this.eventTimes.filter((e) => t - e.t < T.EVENT_BURST_WINDOW_MS);
    this.onEvent({ type, t, target, meta });
  }

  ingest(sample) {
    const { x, y, t, target } = sample;
    this.buffer.push(sample);
    const cutoff = t - T.BUFFER_MS;
    while (this.buffer.length && this.buffer[0].t < cutoff) this.buffer.shift();

    const win200 = this.buffer.filter((s) => t - s.t <= 200);
    const win300 = this.buffer.filter((s) => t - s.t <= T.JITTER_WINDOW_MS);

    if (target) this.lastOnTargetT = t;
    else if (this.lastOnTargetT && t - this.lastOnTargetT > T.SKIP_GAP_MS) {
      this.emit('SKIP', null, { t, gap: t - this.lastOnTargetT });
      this.lastOnTargetT = t;
    }

    if (stddev(win300) > T.JITTER_STD_PX) {
      this.emit('JITTER', target, { t, std: stddev(win300) });
    }

    if (win200.length >= 3 && dispersion(win200) < T.FIXATION_DISP_PX) {
      if (!this.openFixation) {
        this.openFixation = { startT: win200[0].t, target, x, y };
      } else {
        this.openFixation.endT = t;
        this.openFixation.target = target ?? this.openFixation.target;
        const dur = t - this.openFixation.startT;
        if (dur > T.CONFUSION_MS && !this.openFixation.confusionReported) {
          this.openFixation.confusionReported = true;
          this.emit('CONFUSION', this.openFixation.target, { t, durationMs: dur });
        }
      }
    } else if (this.openFixation) {
      const fix = this.openFixation;
      fix.endT = fix.endT ?? t;
      this.openFixation = null;
      if (fix.endT - fix.startT >= T.FIXATION_MIN_MS) {
        this.fixationsClosed.push(fix);
        if (this.fixationsClosed.length > T.REGRESSION_WINDOW) this.fixationsClosed.shift();
        this.emit('FIXATION', fix.target, { t, durationMs: fix.endT - fix.startT });

        const prev = this.fixationsClosed[this.fixationsClosed.length - 2];
        if (prev) {
          const dx = fix.x - prev.x;
          const dy = fix.y - prev.y;
          const backward = dx < -20;
          if (backward) {
            this.regressionsRecent.push(t);
            this.regressionsRecent = this.regressionsRecent.filter((rt) => t - rt < 5000);
            this.emit('REGRESSION', fix.target, { t, dx, dy });
            if (this.regressionsRecent.length >= T.REGRESSION_HIGH) {
              this.emit('DECODING_ISSUE', fix.target, { t, count: this.regressionsRecent.length });
              this.regressionsRecent = [];
            }
          } else {
            this.emit('SACCADE', fix.target, { t, dx, dy });
          }
        }
      }
    }
  }

  isBurst(t = Date.now()) {
    const recent = this.eventTimes.filter((e) => t - e.t < T.EVENT_BURST_WINDOW_MS && e.type !== 'FIXATION' && e.type !== 'SACCADE');
    return recent.length >= T.EVENT_BURST_COUNT;
  }

  calmFor(t = Date.now()) {
    const last = this.eventTimes
      .filter((e) => e.type !== 'FIXATION' && e.type !== 'SACCADE')
      .map((e) => e.t)
      .sort((a, b) => b - a)[0];
    return last ? t - last : Infinity;
  }
}
