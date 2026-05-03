import mongoose from 'mongoose';

const behaviorEventSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSession', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    t: { type: Number, required: true },
    type: {
      type: String,
      enum: ['FIXATION', 'CONFUSION', 'REGRESSION', 'DECODING_ISSUE', 'JITTER', 'SKIP', 'SACCADE'],
      required: true,
    },
    target: String,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

behaviorEventSchema.index({ sessionId: 1, t: 1 });
behaviorEventSchema.index({ userId: 1, type: 1, createdAt: -1 });

export default mongoose.model('BehaviorEvent', behaviorEventSchema);
