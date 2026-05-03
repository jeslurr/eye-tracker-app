import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import mongoose from 'mongoose';

async function main() {
  await connectDB();
  const email = 'parent@example.com';
  let parent = await User.findOne({ email });
  if (!parent) {
    parent = await User.create({
      email,
      passwordHash: await bcrypt.hash('password', 10),
      role: 'parent',
      name: 'Demo Parent',
    });
    await User.create({ name: 'Sam', role: 'child', parentId: parent._id });
    await User.create({ name: 'Aria', role: 'child', parentId: parent._id });
    console.log('seeded:', email, '/ password');
  } else {
    console.log('already seeded');
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
