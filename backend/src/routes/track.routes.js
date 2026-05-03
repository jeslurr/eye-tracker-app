import { Router } from 'express';
import { z } from 'zod';
import GazeSample from '../models/GazeSample.js';
import GameSession from '../models/GameSession.js';
import { HttpError } from '../middleware/error.js';

const r = Router();

const sampleSchema = z.object({
  t: z.number(),
  x: z.number(),
  y: z.number(),
  target: z.string().optional(),
});

r.post('/', async (req, res, next) => {
  try {
    const { sessionId, samples } = z
      .object({
        sessionId: z.string(),
        samples: z.array(sampleSchema).min(1).max(500),
      })
      .parse(req.body);

    const session = await GameSession.findById(sessionId).lean();
    if (!session) throw new HttpError(404, 'not_found', 'Session not found');

    const docs = samples.map((s) => ({ ...s, sessionId, userId: session.userId }));
    await GazeSample.insertMany(docs, { ordered: false });
    res.json({ accepted: docs.length });
  } catch (e) {
    next(e);
  }
});

export default r;
