import { Router } from 'express';
import { z } from 'zod';
import { BehaviorAnalyzer } from '../services/behaviorAnalysis.js';
import { AdaptiveEngine } from '../services/adaptiveEngine.js';

const r = Router();

r.post('/', (req, res, next) => {
  try {
    const { samples } = z
      .object({
        samples: z
          .array(z.object({ t: z.number(), x: z.number(), y: z.number(), target: z.string().optional() }))
          .min(1),
      })
      .parse(req.body);

    const events = [];
    const actions = [];
    const analyzer = new BehaviorAnalyzer((evt) => events.push(evt));
    const engine = new AdaptiveEngine((act) => actions.push(act));

    for (const s of samples) {
      const before = events.length;
      analyzer.ingest(s);
      for (let i = before; i < events.length; i++) {
        engine.onBehaviorEvent(events[i], analyzer);
      }
    }
    res.json({ events, actions });
  } catch (e) {
    next(e);
  }
});

export default r;
