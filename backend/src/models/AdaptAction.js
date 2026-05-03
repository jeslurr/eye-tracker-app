import mongoose from 'mongoose';

const adaptActionSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSession', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    t: { type: Number, required: true },
    action: {
      type: String,
      enum: [
        'HIGHLIGHT_LETTERS',
        'SPLIT_WORD',
        'PLAY_AUDIO',
        'SIMPLIFY_UI',
        'ATTENTION_PROMPT',
        'DIFFICULTY_DOWN',
        'DIFFICULTY_UP',
      ],
      required: true,
    },
    target: String,
    reason: String,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

adaptActionSchema.index({ sessionId: 1, t: 1 });

export default mongoose.model('AdaptAction', adaptActionSchema);
