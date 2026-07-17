import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', '..', 'jarvispays.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    db.exec(schema);

    // Lightweight forward-compatible migrations for databases created by an
    // earlier MVP build. New installations receive these columns from schema.
    const columns = db.prepare('PRAGMA table_info(connected_sites)').all().map((column) => column.name);
    const additions = [
      ['adapter_id', "TEXT NOT NULL DEFAULT 'unsupported'"],
      ['merchant_stellar_address', 'TEXT'],
      ['auto_confirm_threshold', 'REAL DEFAULT 0'],
    ];
    for (const [name, definition] of additions) {
      if (!columns.includes(name)) db.exec(`ALTER TABLE connected_sites ADD COLUMN ${name} ${definition}`);
    }
    const walletColumns = db.prepare('PRAGMA table_info(wallets)').all().map((column) => column.name);
    if (!walletColumns.includes('key_version')) db.exec('ALTER TABLE wallets ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1');

    console.log('✅ Database initialized');
  }
  return db;
}

export default getDb;
