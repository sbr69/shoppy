const windowMs = 15 * 60 * 1000;

const stores = {
  general: new Map(),
  auth: new Map(),
  chat: new Map(),
};

function cleanup(store) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.start > windowMs) {
      store.delete(key);
    }
  }
}

function createLimiter(storeName, max) {
  const store = stores[storeName];

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { count: 0, start: now };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));

    if (entry.count > max) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
      });
    }

    next();
  };
}

// Clean up expired entries every 5 minutes
setInterval(() => {
  Object.values(stores).forEach(cleanup);
}, 5 * 60 * 1000);

export const generalLimiter = createLimiter('general', 100);
export const authLimiter = createLimiter('auth', 20);
export const chatLimiter = createLimiter('chat', 30);
