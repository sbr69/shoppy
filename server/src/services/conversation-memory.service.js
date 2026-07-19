import getDb from '../db/database.js';

const clean = (value, limit = 400) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const unique = (items, limit) => [...new Set(items.filter(Boolean))].slice(-limit);

function parseMetadata(value) {
  if (!value || typeof value === 'object') return value || null;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Keep a compact, durable working memory separate from the immutable chat
 * transcript. The transcript remains the source of truth; this is the
 * context budget used by the decision model on every future turn.
 */
export function buildConversationMemory({ existing = null, messages = [], shoppingTask = null, preferences = {} } = {}) {
  const previousFacts = Array.isArray(existing?.facts?.userStatements) ? existing.facts.userStatements : [];
  const previousDecisions = Array.isArray(existing?.facts?.decisions) ? existing.facts.decisions : [];
  const userStatements = unique([
    ...previousFacts.map((value) => clean(value, 260)),
    ...messages.filter((message) => message.role === 'user').map((message) => clean(message.content, 260)),
  ], 32);
  const decisions = unique([
    ...previousDecisions.map((value) => clean(value, 260)),
    ...messages.filter((message) => message.role === 'agent').map((message) => {
      const metadata = parseMetadata(message.metadata);
      if (metadata?.product?.name) return `Shown: ${clean(metadata.product.name, 160)}`;
      if (metadata?.purchase?.txHash) return `Purchase status: ${clean(message.content, 220)}`;
      return '';
    }),
  ], 20);
  const goal = shoppingTask?.goal && typeof shoppingTask.goal === 'object' ? shoppingTask.goal : null;
  const preferenceText = [
    ...(Array.isArray(preferences?.likes) ? preferences.likes.map((value) => `likes ${clean(value, 100)}`) : []),
    ...(Array.isArray(preferences?.avoids) ? preferences.avoids.map((value) => `avoids ${clean(value, 100)}`) : []),
  ].slice(0, 12);
  // Preserve the first user request as the conversation anchor as well as the
  // most recent refinements. A simple tail would forget the product category
  // after a long comparison or checkout discussion.
  const memoryStatements = userStatements.length > 10
    ? [userStatements[0], ...userStatements.slice(-9)]
    : userStatements;
  const summary = [
    goal?.rawQuery ? `Active shopping goal: ${clean(goal.rawQuery, 700)}.` : '',
    preferenceText.length ? `Saved preferences: ${preferenceText.join('; ')}.` : '',
    memoryStatements.length ? `Earlier user context: ${memoryStatements.join(' | ')}.` : '',
    decisions.length ? `Prior shopping decisions: ${decisions.slice(-8).join(' | ')}.` : '',
  ].filter(Boolean).join('\n').slice(0, 6000);
  return {
    summary,
    facts: { userStatements, decisions, activeGoal: goal ? { rawQuery: clean(goal.rawQuery, 700), product: clean(goal.product, 280) } : null },
  };
}

export async function getConversationMemory(userId, sessionId) {
  const [memory] = await getDb()`select summary, facts, updated_at from conversation_memories where user_id = ${userId} and session_id = ${sessionId}`;
  return memory || null;
}

export async function saveConversationMemory(userId, sessionId, input) {
  const db = getDb();
  const [existing] = await db`select summary, facts from conversation_memories where user_id = ${userId} and session_id = ${sessionId}`;
  const memory = buildConversationMemory({ ...input, existing });
  const [saved] = await db`
    insert into conversation_memories (session_id, user_id, summary, facts)
    values (${sessionId}, ${userId}, ${memory.summary}, ${db.json(memory.facts)})
    on conflict (session_id) do update set summary = excluded.summary, facts = excluded.facts, updated_at = now()
    returning summary, facts, updated_at`;
  return saved;
}

/** The model sees a bounded current window plus the durable memory—not an unbounded transcript. */
export function boundedConversation(messages = [], memory = null, limit = 16) {
  return {
    durableMemory: clean(memory?.summary, 6000) || null,
    recentMessages: messages.slice(-limit).map((message) => ({
      role: message?.role === 'agent' ? 'agent' : 'user',
      content: clean(message?.content, 1200),
    })),
  };
}
