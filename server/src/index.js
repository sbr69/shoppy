import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/env.js';
import { verifyDatabaseConnection } from './db/database.js';
import { generalLimiter, authLimiter, chatLimiter } from './middleware/rateLimiter.js';
import authRoutes from './routes/auth.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import chatRoutes from './routes/chat.routes.js';
import sitesRoutes from './routes/sites.routes.js';
import purchasesRoutes from './routes/purchases.routes.js';

const app = express();

// ─── Security Headers ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://accounts.google.com", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://accounts.google.com", "https://horizon-testnet.stellar.org", "https://friendbot.stellar.org"],
      frameSrc: ["https://accounts.google.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const localDevOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?$/;

app.use(cors({
  origin(origin, callback) {
    // Vite may be opened through a LAN address during local development.
    const isAllowed = !origin
      || origin === config.clientUrl
      || (config.nodeEnv !== 'production' && localDevOrigin.test(origin));

    callback(isAllowed ? null : new Error('Origin not allowed by CORS'), isAllowed);
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// ─── Global Rate Limiter ───
app.use('/api', generalLimiter);

// ─── Routes (with per-route rate limiting) ───
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/purchases', purchasesRoutes);

// ─── Health check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 handler ───
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ─── Error handler ───
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ─── Start only after the production database is reachable ───
async function start() {
  await verifyDatabaseConnection();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`\n⚡ JarvisPayz server running at http://localhost:${config.port}`);
    console.log(`   Client URL: ${config.clientUrl}`);
    console.log(`   Stellar: ${config.stellarNetwork}`);
    console.log(`   Horizon: ${config.horizonUrl}\n`);
  });
}

start().catch((error) => {
  console.error('Server startup failed:', error.message);
  process.exit(1);
});
