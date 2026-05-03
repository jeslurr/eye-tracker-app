import mongoose from 'mongoose';

const gameSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    level: { type: String, enum: ['shapes', 'letters', 'words', 'sentences'], required: true },
    difficulty: { type: Number, default: 1, min: 1, max: 5 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    deviceMeta: {
      viewportW: Number,
      viewportH: Number,
      dpr: Number,
      ua: String,
    },
    status: { type: String, enum: ['active', 'ended', 'aborted'], default: 'active' },
  },
  { timestamps: true }
);

export default mongoose.model('GameSession', gameSessionSchema);
