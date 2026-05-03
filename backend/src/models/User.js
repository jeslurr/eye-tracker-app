import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    role: { type: String, enum: ['parent', 'teacher', 'child'], required: true },
    name: { type: String, required: true },
    dob: { type: Date },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    prefs: {
      font: { type: String, default: 'OpenDyslexic' },
      fontSizePt: { type: Number, default: 28 },
      audioEnabled: { type: Boolean, default: true },
      contrast: { type: String, enum: ['high', 'normal'], default: 'high' },
    },
  },
  { timestamps: true }
);

userSchema.index({ parentId: 1 });

export default mongoose.model('User', userSchema);
