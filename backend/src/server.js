import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Server as IOServer } from 'socket.io';

import { connectDB } from './config/db.js';
import { registerSocketHandlers } from './socket/index.js';
import { errorHandler, notFound } from './middleware/error.js';

import authRoutes from './routes/auth.routes.js';
import gameRoutes from './routes/games.routes.js';
import trackRoutes from './routes/track.routes.js';
import analyzeRoutes from './routes/analyze.routes.js';
import resultRoutes from './routes/results.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(helmet());
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use('/api/', rateLimit({ windowMs: 60_000, max: 600 }));

app.get('/api/health', (_, res) => res.json({ ok: true, t: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: ORIGIN, credentials: true },
  maxHttpBufferSize: 1e6,
});

await connectDB();
registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
