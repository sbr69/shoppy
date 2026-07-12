import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

let genAI = null;
let model = null;

function getModel() {
  if (!model) {
    if (!config.geminiApiKey || config.geminiApiKey === 'YOUR_GEMINI_API_KEY') {
      return null; // Fallback mode — no API key
    }
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
  }
  return model;
}

/**
 * Send a prompt to Gemini and get a text response.
 * Falls back to a simple keyword-based approach if no API key is set.
 */
export async function generateText(prompt, { jsonMode = false } = {}) {
  const m = getModel();

  if (!m) {
    // Fallback: return null, callers handle this
    return null;
  }

  try {
    const generationConfig = jsonMode
      ? { responseMimeType: 'application/json' }
      : {};

    const result = await m.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    });

    const response = result.response;
    return response.text();
  } catch (err) {
    console.error('❌ Gemini API error:', err.message);
    throw err;
  }
}

/**
 * Parse a JSON response from Gemini, handling markdown code fences.
 */
export function parseJsonResponse(text) {
  if (!text) return null;

  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  try {
    return JSON.parse(cleaned.trim());
  } catch (err) {
    console.error('❌ JSON parse error:', err.message, '\nRaw text:', text);
    return null;
  }
}
