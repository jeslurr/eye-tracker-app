import mongoose from 'mongoose';

const gameResultSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSession', required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    level: { type: String, required: true },
    correct: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    avgReactionMs: Number,
    avgDecisionDelayMs: Number,
    brainSpeed: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'] },
    eventCounts: {
      CONFUSION: { type: Number, default: 0 },
      REGRESSION: { type: Number, default: 0 },
      DECODING_ISSUE: { type: Number, default: 0 },
      JITTER: { type: Number, default: 0 },
      SKIP: { type: Number, default: 0 },
    },
    promoted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('GameResult', gameResultSchema);
