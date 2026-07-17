import postgres from 'postgres';
import config from '../config/env.js';

let sql;

export function getDb() {
  if (!sql) {
    if (!config.supabaseDbUrl) {
      throw new Error('SUPABASE_DB_URL is required. Set it to the Supabase transaction-pooler connection string.');
    }
    sql = postgres(config.supabaseDbUrl, {
      max: config.databasePoolMax,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: config.nodeEnv === 'production' ? 'require' : undefined,
    });
  }
  return sql;
}

export async function verifyDatabaseConnection() {
  const db = getDb();
  await db`select 1 as ok`;
  await db`select id from users limit 1`;
  console.log('✅ Supabase PostgreSQL connection verified');
}

export async function closeDatabase() {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = undefined;
  }
}

export default getDb;
