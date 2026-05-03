import { Router } from 'express';
import mongoose from 'mongoose';
import GameResult from '../models/GameResult.js';
import GazeSample from '../models/GazeSample.js';
import BehaviorEvent from '../models/BehaviorEvent.js';
import AdaptAction from '../models/AdaptAction.js';

const r = Router();

r.get('/:userId', async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    const results = await GameResult.find({ userId }).sort({ createdAt: -1 }).limit(30).lean();

    const heatmap = await GazeSample.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: { x: { $floor: { $divide: ['$x', 40] } }, y: { $floor: { $divide: ['$y', 40] } } },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, x: '$_id.x', y: '$_id.y', count: 1 } },
      { $sort: { count: -1 } },
      { $limit: 1000 },
    ]);

    const difficultyZones = await BehaviorEvent.aggregate([
      { $match: { userId, type: { $in: ['CONFUSION', 'DECODING_ISSUE'] } } },
      { $group: { _id: { target: '$target', type: '$type' }, count: { $sum: 1 } } },
      { $project: { _id: 0, target: '$_id.target', type: '$_id.type', count: 1 } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);

    const actionDensity = await AdaptAction.aggregate([
      { $match: { userId } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $project: { _id: 0, action: '$_id', count: 1 } },
    ]);

    const brainSpeedTrend = results
      .map((r) => ({ at: r.createdAt, brainSpeed: r.brainSpeed, level: r.level }))
      .reverse();

    res.json({ results, heatmap, difficultyZones, actionDensity, brainSpeedTrend });
  } catch (e) {
    next(e);
  }
});

export default r;
