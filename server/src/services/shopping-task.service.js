import getDb from '../db/database.js';

const text = (value, limit = 300) => typeof value === 'string' ? value.trim().slice(0, limit) : null;
const list = (value, limit = 12) => Array.isArray(value)
  ? [...new Set(value.map((item) => text(String(item), 160)).filter(Boolean))].slice(0, limit)
  : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function safeGoal(intent = {}) {
  return {
    rawQuery: text(intent.rawQuery, 1_000),
    product: text(intent.product),
    maxPrice: number(intent.maxPrice),
    minPrice: number(intent.minPrice),
    currency: text(intent.currency, 16),
    quantity: Math.min(Math.max(Number(intent.quantity) || 1, 1), 100),
    mustHave: list(intent.mustHave),
    preferences: list(intent.preferences),
    exclusions: list(intent.exclusions),
    useCases: list(intent.useCases),
    searchQueries: list(intent.searchQueries, 4),
  };
}

function safeProduct(product = {}) {
  return {
    id: text(String(product.id || ''), 160),
    siteId: text(String(product.siteId || ''), 80),
    name: text(product.name, 240),
    brand: text(product.brand, 120),
    category: text(product.category, 120),
    price: number(product.price),
    currency: text(product.currency, 16),
    rating: number(product.rating),
  };
}

function safeContext(context = {}) {
  const candidates = Array.isArray(context.candidates) ? context.candidates.map(safeProduct).filter((item) => item.id && item.siteId && item.name).slice(0, 24) : [];
  const seen = Array.isArray(context.seenProducts) ? context.seenProducts.map(safeProduct).filter((item) => item.id && item.siteId && item.name).slice(0, 24) : [];
  return { candidates, seenProducts: seen, lastAction: text(context.lastAction, 48) || 'search' };
}

/** A compact, durable representation of the active shopping goal in a chat. */
export async function getShoppingTask(userId, sessionId) {
  const [task] = await getDb()`select status, goal, context, updated_at from shopping_tasks where user_id = ${userId} and session_id = ${sessionId} and status = 'active'`;
  return task || null;
}

export async function saveShoppingTask(userId, sessionId, { goal, context, status = 'active' }) {
  const cleanGoal = safeGoal(goal);
  const cleanContext = safeContext(context);
  const [task] = await getDb()`
    insert into shopping_tasks (user_id, session_id, status, goal, context)
    values (${userId}, ${sessionId}, ${status}, ${getDb().json(cleanGoal)}, ${getDb().json(cleanContext)})
    on conflict (session_id) do update set
      user_id = excluded.user_id, status = excluded.status, goal = excluded.goal,
      context = excluded.context, updated_at = now()
    returning status, goal, context, updated_at`;
  return task;
}

export async function markShoppingTask(userId, sessionId, status) {
  if (!['completed', 'cancelled'].includes(status)) throw new Error('Invalid shopping task state');
  await getDb()`update shopping_tasks set status = ${status}, updated_at = now() where user_id = ${userId} and session_id = ${sessionId} and status = 'active'`;
}

/** Build the exact immutable goal that an alternatives/refinement turn reuses. */
export function taskGoalToIntent(task) {
  const goal = task?.goal && typeof task.goal === 'object' ? task.goal : null;
  if (!goal?.product) return null;
  return {
    ...goal,
    rawQuery: goal.rawQuery || goal.product,
    quantity: Math.min(Math.max(Number(goal.quantity) || 1, 1), 100),
    mustHave: list(goal.mustHave), preferences: list(goal.preferences), exclusions: list(goal.exclusions), useCases: list(goal.useCases),
    searchQueries: list(goal.searchQueries, 4),
  };
}

export function taskSeenProductKeys(task) {
  const seen = Array.isArray(task?.context?.seenProducts) ? task.context.seenProducts : [];
  return new Set(seen.map((product) => `${product.siteId}:${product.id}`));
}
