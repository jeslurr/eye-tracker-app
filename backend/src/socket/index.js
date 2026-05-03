import GameSession from '../models/GameSession.js';
import GazeSample from '../models/GazeSample.js';
import BehaviorEvent from '../models/BehaviorEvent.js';
import AdaptAction from '../models/AdaptAction.js';
import { BehaviorAnalyzer } from '../services/behaviorAnalysis.js';
import { AdaptiveEngine } from '../services/adaptiveEngine.js';

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const sessionState = new Map();

    socket.on('session.join', async ({ sessionId }, ack) => {
      const session = await GameSession.findById(sessionId).lean();
      if (!session) return ack?.({ ok: false, error: 'not_found' });

      const sampleQueue = [];
      let engine;
      const analyzer = new BehaviorAnalyzer((evt) => {
        socket.emit('behavior.event', evt);
        if (engine && evt.type !== 'FIXATION' && evt.type !== 'SACCADE') {
          engine.onBehaviorEvent(evt, analyzer);
        }
        BehaviorEvent.create({
          sessionId,
          userId: session.userId,
          t: evt.t,
          type: evt.type,
          target: evt.target,
          meta: evt.meta,
        }).catch((e) => console.error('[behavior persist]', e.message));
      });
      engine = new AdaptiveEngine((act) => {
        socket.emit('adapt.action', act);
        AdaptAction.create({
          sessionId,
          userId: session.userId,
          t: act.t,
          action: act.action,
          target: act.target,
          reason: act.reason,
          meta: act.meta,
        }).catch((e) => console.error('[adapt persist]', e.message));
      });

      sessionState.set(sessionId, { session, analyzer, engine, sampleQueue, correct: 0 });
      socket.join(`session:${sessionId}`);
      ack?.({ ok: true });
    });

    socket.on('gaze.sample', (sample) => {
      const state = sessionState.get(sample.sessionId);
      if (!state) return;
      state.analyzer.ingest(sample);
      state.sampleQueue.push({ t: sample.t, x: sample.x, y: sample.y, target: sample.target });
      if (state.sampleQueue.length >= 30) flushSamples(state, sample.sessionId);
    });

    socket.on('gaze.batch', ({ sessionId, samples = [] }) => {
      const state = sessionState.get(sessionId);
      if (!state) return;
      for (const s of samples) {
        state.analyzer.ingest(s);
        state.sampleQueue.push({ t: s.t, x: s.x, y: s.y, target: s.target });
      }
      flushSamples(state, sessionId);
    });

    socket.on('game.tick', ({ sessionId, correct }) => {
      const state = sessionState.get(sessionId);
      if (!state) return;
      state.correct = correct;
      state.engine.onTick(Date.now(), state.analyzer, { correct });
    });

    socket.on('session.end', async ({ sessionId }) => {
      const state = sessionState.get(sessionId);
      if (!state) return;
      await flushSamples(state, sessionId);
      sessionState.delete(sessionId);
      socket.leave(`session:${sessionId}`);
    });

    socket.on('disconnect', async () => {
      for (const [sid, state] of sessionState.entries()) {
        try { await flushSamples(state, sid); } catch {}
      }
      sessionState.clear();
    });
  });
}

async function flushSamples(state, sessionId) {
  if (!state.sampleQueue.length) return;
  const docs = state.sampleQueue.splice(0).map((s) => ({
    sessionId,
    userId: state.session.userId,
    t: s.t,
    x: s.x,
    y: s.y,
    target: s.target,
  }));
  try {
    await GazeSample.insertMany(docs, { ordered: false });
  } catch (e) {
    console.error('[gaze persist]', e.message);
  }
}
