import { generateText, parseJsonResponse } from './llm.service.js';

/**
 * Parse user's natural language message into a structured shopping intent.
 *
 * LLM Call 1: Extract product name, budget, preferences, constraints.
 * Falls back to keyword extraction if no Gemini API key is configured.
 */
export async function parseIntent(message) {
  const prompt = `You are a shopping assistant AI. Parse the following user message into a structured shopping intent.

Extract:
- "action": one of "search", "confirm_purchase", "cancel", "greeting", "question", "other"
- "product": the product name/description (null if not a search)
- "maxPrice": maximum price as a number (null if not specified)
- "minPrice": minimum price as a number (null if not specified)
- "currency": currency code like "INR", "USD" (default "INR" if rupees/₹ mentioned, "XLM" if XLM mentioned)
- "quantity": number of items (default 1)
- "preferences": array of preference strings (e.g. ["wireless", "black color", "brand: Sony"])
- "constraints": array of constraint strings (e.g. ["free shipping", "in stock"])
- "rawQuery": the original search query cleaned up

User message: "${message}"

Respond ONLY with valid JSON, no explanation.`;

  const response = await generateText(prompt, { jsonMode: true });
  const parsed = parseJsonResponse(response);

  if (parsed) {
    return parsed;
  }

  // Fallback: simple keyword parsing
  return fallbackParseIntent(message);
}

/**
 * Fallback intent parser when Gemini is unavailable.
 * Uses simple keyword matching.
 */
function fallbackParseIntent(message) {
  const lower = message.toLowerCase().trim();

  // Check for confirmation actions
  if (/^(yes|buy|confirm|purchase|go ahead|do it|buy it|proceed|ok buy)/.test(lower)) {
    return { action: 'confirm_purchase', product: null, rawQuery: message };
  }

  // Check for cancel
  if (/^(no|cancel|skip|nevermind|don't|stop)/.test(lower)) {
    return { action: 'cancel', product: null, rawQuery: message };
  }

  // Check for greetings
  if (/^(hi|hello|hey|sup|yo|good morning|good evening)/.test(lower)) {
    return { action: 'greeting', product: null, rawQuery: message };
  }

  // Try to extract price constraints
  let maxPrice = null;
  let currency = 'INR';
  const priceMatch = lower.match(/(?:under|below|less than|max|upto|up to|within)\s*(?:₹|rs\.?|inr)?\s*(\d+[\d,]*)/);
  if (priceMatch) {
    maxPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
  }

  const rupeeMatch = lower.match(/(?:₹|rs\.?|rupees?|inr)\s*(\d+[\d,]*)/);
  if (rupeeMatch && !maxPrice) {
    maxPrice = parseFloat(rupeeMatch[1].replace(/,/g, ''));
  }

  if (/xlm/i.test(lower)) {
    currency = 'XLM';
  }

  // Extract product — remove price/action words
  let product = lower
    .replace(/^(buy|get|find|search|order|i want|i need|get me|buy me|find me|show me)\s+/i, '')
    .replace(/(?:under|below|less than|max|upto|up to|within)\s*(?:₹|rs\.?|inr)?\s*\d+[\d,]*/g, '')
    .replace(/(?:₹|rs\.?|rupees?|inr)\s*\d+[\d,]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!product || product.length < 2) {
    return { action: 'question', product: null, rawQuery: message };
  }

  return {
    action: 'search',
    product,
    maxPrice,
    minPrice: null,
    currency,
    quantity: 1,
    preferences: [],
    constraints: [],
    rawQuery: message,
  };
}
