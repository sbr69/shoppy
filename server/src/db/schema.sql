-- JarvisPayz Database Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  encrypted_secret BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS connected_sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  site_name TEXT NOT NULL,
  adapter_id TEXT NOT NULL DEFAULT 'unsupported',
  merchant_stellar_address TEXT,
  auth_token TEXT,
  spending_cap REAL DEFAULT 1000.0,
  auto_confirm_threshold REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  content TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT,
  product_name TEXT NOT NULL,
  product_url TEXT,
  product_image TEXT,
  price_xlm REAL NOT NULL,
  stellar_tx_hash TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (site_id) REFERENCES connected_sites(id)
);

CREATE TABLE IF NOT EXISTS purchase_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  product_json TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_xlm REAL,
  final_total_json TEXT,
  merchant_order_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('selected', 'confirmed', 'awaiting_payment', 'payment_submitted', 'payment_confirmed', 'order_confirmed', 'cancelled', 'expired', 'failed')),
  reserved_xlm REAL NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id),
  FOREIGN KEY (site_id) REFERENCES connected_sites(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_user_created ON purchases(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_user_state ON purchase_intents(user_id, state, expires_at);
