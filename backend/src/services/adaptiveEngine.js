import { THRESHOLDS as T } from './thresholds.js';

const MAP = {
  CONFUSION: 'HIGHLIGHT_LETTERS',
  DECODING_ISSUE: 'SPLIT_WORD',
  JITTER: 'SIMPLIFY_UI',
  SKIP: 'ATTENTION_PROMPT',
};

export class AdaptiveEngine {
  constructor(emit) {
    this.emit = emit;
    this.recentActions = [];
    this.cooldowns = new Map();
  }

  cooldownOk(action, t, ms = 1500) {
    const last = this.cooldowns.get(action);
    if (last && t - last < ms) return false;
    this.cooldowns.set(action, t);
    return true;
  }

  onBehaviorEvent(evt, analyzer) {
    const t = evt.t;
    const primary = MAP[evt.type];
    if (primary && this.cooldownOk(primary, t)) {
      this.dispatch(primary, evt.target, evt.type, evt.meta);
      if (evt.type === 'DECODING_ISSUE' && this.cooldownOk('PLAY_AUDIO', t, 2500)) {
        this.dispatch('PLAY_AUDIO', evt.target, 'DECODING_ISSUE_AUDIO', evt.meta);
      }
    }

    if (analyzer.isBurst(t) && this.cooldownOk('DIFFICULTY_DOWN', t, 6000)) {
      this.dispatch('DIFFICULTY_DOWN', evt.target, 'EVENT_BURST');
    }
  }

  onTick(t, analyzer, { correct }) {
    if (correct && analyzer.calmFor(t) > T.CALM_FOR_PROMOTION_MS && this.cooldownOk('DIFFICULTY_UP', t, 10000)) {
      this.dispatch('DIFFICULTY_UP', null, 'CALM_AND_CORRECT');
    }
  }

  dispatch(action, target, reason, meta) {
    const t = Date.now();
    this.recentActions.push({ action, t });
    this.emit({ action, target, reason, meta, t });
  }
}
