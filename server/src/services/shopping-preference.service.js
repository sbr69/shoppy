import getDb from '../db/database.js';

const clean = (value) => Array.isArray(value)
  ? [...new Set(value.map((item) => String(item).trim()).filter((item) => item && item.length <= 120))].slice(0, 20)
  : [];

export async function getShoppingPreferences(userId) {
  const [row] = await getDb()`select preferences from user_shopping_preferences where user_id = ${userId}`;
  return row?.preferences && typeof row.preferences === 'object' ? row.preferences : {};
}

/** Preferences are persisted only after the user expressly asks the agent to remember them. */
export async function saveShoppingPreferences(userId, input = {}) {
  const current = await getShoppingPreferences(userId);
  const preferences = {
    likes: clean([...(current.likes || []), ...(input.likes || [])]),
    avoids: clean([...(current.avoids || []), ...(input.avoids || [])]),
    useCases: clean([...(current.useCases || []), ...(input.useCases || [])]),
  };
  await getDb()`insert into user_shopping_preferences (user_id, preferences) values (${userId}, ${getDb().json(preferences)}) on conflict (user_id) do update set preferences = excluded.preferences, updated_at = now()`;
  return preferences;
}
