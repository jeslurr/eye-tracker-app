import { BRAIN_SPEED } from './thresholds.js';

export function classifyBrainSpeed(reactionMs, decisionDelayMs) {
  if (reactionMs == null || decisionDelayMs == null) return null;
  if (reactionMs < BRAIN_SPEED.HIGH.rt && decisionDelayMs < BRAIN_SPEED.HIGH.dd) return 'HIGH';
  if (reactionMs < BRAIN_SPEED.MEDIUM.rt && decisionDelayMs < BRAIN_SPEED.MEDIUM.dd) return 'MEDIUM';
  return 'LOW';
}

export function aggregateBrainSpeed(samples) {
  if (!samples.length) return { avgReactionMs: null, avgDecisionDelayMs: null, brainSpeed: null };
  const rt = samples.reduce((a, s) => a + (s.reactionMs || 0), 0) / samples.length;
  const dd = samples.reduce((a, s) => a + (s.decisionDelayMs || 0), 0) / samples.length;
  return { avgReactionMs: Math.round(rt), avgDecisionDelayMs: Math.round(dd), brainSpeed: classifyBrainSpeed(rt, dd) };
}
