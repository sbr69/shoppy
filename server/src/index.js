import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/env.js';
import { getDb } from './db/database.js';
import authRoutes from './routes/auth.routes.js';
import walletRoutes from './routes/wallet.routes.js';

const app = express();

// ─── Middleware ───
app.use(helmet());
app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json());

// ─── Initialize Database ───
getDb();

// ─── Routes ───
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

// ─── Health check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error handler ───
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───
app.listen(config.port, () => {
  console.log(`\n⚡ JarvisPayz server running at http://localhost:${config.port}`);
  console.log(`   Client URL: ${config.clientUrl}`);
  console.log(`   Stellar: ${config.stellarNetwork}`);
  console.log(`   Horizon: ${config.horizonUrl}\n`);
});
