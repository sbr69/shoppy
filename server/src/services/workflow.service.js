import getDb from '../db/database.js';

/** A durable, append-only trace for constrained agent workers. */
export async function recordWorkflowEvent({ userId, sessionId = null, purchaseIntentId = null, stage, status, detail, metadata = {} }) {
  try {
    await getDb()`insert into workflow_events (user_id, session_id, purchase_intent_id, stage, status, detail, metadata)
      values (${userId}, ${sessionId}, ${purchaseIntentId}, ${stage}, ${status}, ${detail || null}, ${getDb().json(metadata)})`;
  } catch (error) {
    // Observability must never make a confirmed payment look failed.
    console.error('Workflow event recording failed:', error.message);
  }
}

export async function getWorkflowEvents(userId, { sessionId, purchaseIntentId, limit = 100 } = {}) {
  const db = getDb();
  if (purchaseIntentId) return db`select * from workflow_events where user_id = ${userId} and purchase_intent_id = ${purchaseIntentId} order by created_at asc limit ${limit}`;
  if (sessionId) return db`select * from workflow_events where user_id = ${userId} and session_id = ${sessionId} order by created_at asc limit ${limit}`;
  return db`select * from workflow_events where user_id = ${userId} order by created_at desc limit ${limit}`;
}
