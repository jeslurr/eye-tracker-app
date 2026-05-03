import { Router } from 'express';
import { z } from 'zod';
import GameSession from '../models/GameSession.js';
import GameResult from '../models/GameResult.js';
import BehaviorEvent from '../models/BehaviorEvent.js';
import { getTargets, nextLevelFor, shouldPromote, PROGRESSION } from '../services/gameLogic.js';
import { aggregateBrainSpeed } from '../services/brainSpeed.js';
import { HttpError } from '../middleware/error.js';

const r = Router();

r.get('/levels', (_req, res) => res.json({ levels: PROGRESSION }));

r.get('/next', async (req, res, next) => {
  try {
    const userId = req.query.userId;
    const requestedLevel = req.query.level;
    let level, difficulty;

    if (requestedLevel && PROGRESSION.includes(requestedLevel)) {
      level = requestedLevel;
      difficulty = Number(req.query.difficulty) || 1;
    } else {
      const last = await GameResult.findOne({ userId }).sort({ createdAt: -1 }).lean();
      level = last ? nextLevelFor(last.level, last.promoted) : 'shapes';
      difficulty = Math.max(1, Math.min(5, (last?.promoted ? 1 : 1)));
    }

    res.json({ level, difficulty, targets: getTargets(level, difficulty) });
  } catch (e) {
    next(e);
  }
});

r.post('/session', async (req, res, next) => {
  try {
    const body = z
      .object({
        userId: z.string().optional(),
        level: z.enum(['shapes', 'letters', 'words', 'sentences']),
        difficulty: z.number().min(1).max(5).default(1),
        deviceMeta: z.record(z.any()).optional(),
      })
      .parse(req.body);

    const userId = body.userId;
    const session = await GameSession.create({
      userId,
      level: body.level,
      difficulty: body.difficulty,
      deviceMeta: body.deviceMeta,
    });
    res.status(201).json({ session, targets: getTargets(body.level, body.difficulty) });
  } catch (e) {
    next(e);
  }
});

r.post('/session/:id/end', async (req, res, next) => {
  try {
    const body = z
      .object({
        correct: z.number().min(0),
        total: z.number().min(0),
        reactions: z
          .array(z.object({ reactionMs: z.number(), decisionDelayMs: z.number() }))
          .default([]),
      })
      .parse(req.body);

    const session = await GameSession.findById(req.params.id);
    if (!session) throw new HttpError(404, 'not_found', 'Session not found');
    session.endedAt = new Date();
    session.status = 'ended';
    await session.save();

    const events = await BehaviorEvent.find({ sessionId: session._id }).select('type').lean();
    const eventCounts = events.reduce(
      (acc, e) => ((acc[e.type] = (acc[e.type] || 0) + 1), acc),
      { CONFUSION: 0, REGRESSION: 0, DECODING_ISSUE: 0, JITTER: 0, SKIP: 0 }
    );

    const speed = aggregateBrainSpeed(body.reactions);
    const result = await GameResult.create({
      sessionId: session._id,
      userId: session.userId,
      level: session.level,
      correct: body.correct,
      total: body.total,
      eventCounts,
      ...speed,
      promoted: false,
    });
    result.promoted = shouldPromote(result);
    await result.save();

    res.json({
      result,
      next: { level: nextLevelFor(session.level, result.promoted) },
    });
  } catch (e) {
    next(e);
  }
});

export default r;
