import mongoose from 'mongoose';

const gazeSampleSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSession', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    t: { type: Number, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    target: { type: String },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  },
  { versionKey: false }
);

gazeSampleSchema.index({ sessionId: 1, t: 1 });

export default mongoose.model('GazeSample', gazeSampleSchema);
