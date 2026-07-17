const MAX_MESSAGE_LENGTH = 2_000;

export function validateChatMessage(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Message is required');
  if (value.length > MAX_MESSAGE_LENGTH) throw new Error(`Message must be at most ${MAX_MESSAGE_LENGTH} characters`);
  return value.trim();
}

export function parseFiniteNonNegative(value, field) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return number;
}

export function validateSiteUpdate(updates) {
  const clean = {};
  if (updates.siteName !== undefined) {
    if (typeof updates.siteName !== 'string' || !updates.siteName.trim() || updates.siteName.length > 100) {
      throw new Error('siteName must be 1–100 characters');
    }
    clean.siteName = updates.siteName.trim();
  }
  if (updates.spendingCap !== undefined) clean.spendingCap = parseFiniteNonNegative(updates.spendingCap, 'spendingCap');
  if (updates.autoConfirmThreshold !== undefined) clean.autoConfirmThreshold = parseFiniteNonNegative(updates.autoConfirmThreshold, 'autoConfirmThreshold');
  if (updates.status !== undefined) {
    if (!['active', 'paused'].includes(updates.status)) throw new Error('status must be active or paused');
    clean.status = updates.status;
  }
  return clean;
}

export function validatePurchaseIntentId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Invalid purchase intent ID');
  return value;
}
