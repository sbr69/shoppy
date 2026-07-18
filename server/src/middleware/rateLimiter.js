const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

const stores = {
  general: new Map(),
  auth: new Map(),
  chatMessage: new Map(),
  chatRead: new Map(),
};

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Message routes run after JWT authentication, so each signed-in user gets an
// independent allowance. IP is retained only as a safe fallback for routes
// that do not yet have an authenticated identity.
function userOrIp(req) {
  return req.user?.userId ? `user:${req.user.userId}` : `ip:${clientIp(req)}`;
}

function cleanup(store) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.start >= entry.windowMs) store.delete(key);
  }
}

function createLimiter({ storeName, max, windowMs, keyFor = clientIp, skip }) {
  const store = stores[storeName];

  return (req, res, next) => {
    if (skip?.(req)) return next();

    const now = Date.now();
    const key = keyFor(req);
    let entry = store.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { count: 0, start: now, windowMs };
      store.set(key, entry);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - entry.start)) / 1000));
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil((entry.start + windowMs) / 1000));

    if (entry.count >= max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfterSeconds,
      });
    }

    entry.count += 1;
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    next();
  };
}

// Broad IP abuse protection for non-chat APIs. Chat routes have their own
// user-aware limits below, so loading a conversation cannot consume a user's
// message allowance or accidentally trip this shared limiter.
export const generalLimiter = createLimiter({
  storeName: 'general',
  max: 600,
  windowMs: FIFTEEN_MINUTES,
  skip: (req) => req.path.startsWith('/chat/'),
});

export const authLimiter = createLimiter({ storeName: 'auth', max: 20, windowMs: FIFTEEN_MINUTES });

// 20 submissions per minute gives normal users comfortable headroom above the
// required 10 messages/minute while protecting expensive LLM and commerce work.
export const chatMessageLimiter = createLimiter({
  storeName: 'chatMessage',
  max: 20,
  windowMs: ONE_MINUTE,
  keyFor: userOrIp,
});

// Read operations do not affect the message allowance. This separate, high
// ceiling only prevents deliberate polling abuse of the database.
export const chatReadLimiter = createLimiter({
  storeName: 'chatRead',
  max: 120,
  windowMs: ONE_MINUTE,
  keyFor: userOrIp,
});

// Clean up expired in-memory entries. A shared external store can replace these
// maps when the API is deployed across multiple server instances.
setInterval(() => {
  Object.values(stores).forEach(cleanup);
}, 5 * 60 * 1000).unref();
