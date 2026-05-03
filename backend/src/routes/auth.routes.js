import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import User from '../models/User.js';
import { signToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';

const r = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(['parent', 'teacher']),
});

const childSchema = z.object({
  name: z.string().min(1),
  dob: z.string().optional(),
});

r.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const exists = await User.findOne({ email: data.email });
    if (exists) throw new HttpError(409, 'email_taken', 'Email already registered');
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await User.create({ ...data, passwordHash });
    const token = signToken({ sub: user.id, role: user.role });
    res.status(201).json({ token, user: sanitize(user) });
  } catch (e) {
    next(e);
  }
});

r.post('/login', async (req, res, next) => {
  try {
    const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'bad_credentials', 'Invalid email or password');
    }
    const token = signToken({ sub: user.id, role: user.role });
    res.json({ token, user: sanitize(user) });
  } catch (e) {
    next(e);
  }
});

r.post('/children', async (req, res, next) => {
  try {
    const data = childSchema.parse(req.body);
    const child = await User.create({
      role: 'child',
      name: data.name,
      dob: data.dob ? new Date(data.dob) : undefined,
    });
    res.status(201).json({ child: sanitize(child) });
  } catch (e) {
    next(e);
  }
});

r.get('/children', async (req, res, next) => {
  try {
    const children = await User.find({ role: 'child' }).lean();
    res.json({ children: children.map(sanitize) });
  } catch (e) {
    next(e);
  }
});

r.post('/children/:id/token', async (req, res, next) => {
  try {
    const child = await User.findOne({ _id: req.params.id });
    if (!child) throw new HttpError(404, 'not_found', 'Child not found');
    const token = signToken({ sub: child.id, role: 'child' });
    res.json({ token, user: sanitize(child) });
  } catch (e) {
    next(e);
  }
});

r.delete('/children/:id', async (req, res, next) => {
  try {
    const child = await User.findOneAndDelete({ _id: req.params.id, role: 'child' });
    if (!child) throw new HttpError(404, 'not_found', 'Child not found');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

function sanitize(u) {
  const o = u.toJSON ? u.toJSON() : u;
  delete o.passwordHash;
  return o;
}

export default r;
