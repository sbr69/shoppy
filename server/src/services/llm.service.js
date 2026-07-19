import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

let genAI = null;
let model = null;
let embeddingModel = null;

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

function getEmbeddingModel() {
  if (!embeddingModel) {
    if (!config.geminiApiKey || config.geminiApiKey === 'YOUR_GEMINI_API_KEY') return null;
    genAI ||= new GoogleGenerativeAI(config.geminiApiKey);
    embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  }
  return embeddingModel;
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

/** Create a normalized semantic-search vector. It never authorizes an action. */
export async function embedText(text, taskType) {
  const m = getEmbeddingModel();
  if (!m || !text?.trim()) return null;
  try {
    const result = await m.embedContent({ content: { role: 'user', parts: [{ text: text.slice(0, 7000) }] }, ...(taskType ? { taskType } : {}) });
    const values = result.embedding?.values;
    if (!Array.isArray(values) || !values.length || values.some((value) => !Number.isFinite(value))) return null;
    const magnitude = Math.hypot(...values);
    return magnitude ? values.map((value) => value / magnitude) : null;
  } catch (error) {
    console.warn('Semantic embedding unavailable:', error.message);
    return null;
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
    // Do not put user conversation or merchant catalog text into server logs.
    console.warn('Gemini JSON response could not be parsed:', err.message);
    return null;
  }
}
