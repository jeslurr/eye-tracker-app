import { Router } from 'express';
import GameResult from '../models/GameResult.js';

const r = Router();

r.get('/:userId', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const results = await GameResult.find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ results });
  } catch (e) {
    next(e);
  }
});

export default r;
