import { generateText, parseJsonResponse } from './llm.service.js';

/**
 * Rank a list of products using LLM and pick the best match.
 * Falls back to price-based sorting when no API key.
 *
 * LLM Call 2: Given products + user intent, rank and explain the best pick.
 */
export async function rankProducts(products, intent) {
  if (!products || products.length === 0) {
    return { bestMatch: null, reasoning: 'No products found matching your criteria.' };
  }

  // If only one product, return it directly
  if (products.length === 1) {
    return {
      bestMatch: products[0],
      reasoning: `Found exactly one match: ${products[0].name}. It fits your requirements.`,
      allProducts: products,
    };
  }

  const prompt = `You are a smart shopping assistant. The user wants: "${intent.rawQuery}"
${intent.maxPrice ? `Budget: max ${intent.currency || 'INR'} ${intent.maxPrice}` : ''}
${intent.preferences?.length ? `Preferences: ${intent.preferences.join(', ')}` : ''}

Here are the available products:
${JSON.stringify(products.map((p, i) => ({
  index: i,
  name: p.name,
  price: p.price,
  currency: p.currency || 'INR',
  description: p.description,
  rating: p.rating,
  inStock: p.inStock,
})), null, 2)}

Pick the BEST product for the user. Consider:
1. Price (within budget if specified)
2. Relevance to what the user asked for
3. Rating and reviews
4. Availability

Respond with JSON:
{
  "bestIndex": <number>,
  "reasoning": "<1-2 sentence explanation of why this is the best pick>"
}`;

  const response = await generateText(prompt, { jsonMode: true });
  const parsed = parseJsonResponse(response);

  if (parsed && Number.isInteger(parsed.bestIndex) && parsed.bestIndex >= 0 && parsed.bestIndex < products.length && typeof parsed.reasoning === 'string') {
    return {
      bestMatch: products[parsed.bestIndex],
      reasoning: parsed.reasoning,
      allProducts: products,
    };
  }

  // Fallback: pick the cheapest in-stock item within budget
  return fallbackRankProducts(products, intent);
}

/**
 * Fallback ranking: cheapest in-stock item within budget.
 */
function fallbackRankProducts(products, intent) {
  let candidates = products.filter(p => p.inStock !== false);

  if (intent.maxPrice) {
    const withinBudget = candidates.filter(p => p.price <= intent.maxPrice);
    if (withinBudget.length > 0) {
      candidates = withinBudget;
    }
  }

  // Sort by price ascending
  candidates.sort((a, b) => a.price - b.price);

  const best = candidates[0] || products[0];
  return {
    bestMatch: best,
    reasoning: `Selected "${best.name}" at ${best.currency || '₹'}${best.price} — the best value within your criteria.`,
    allProducts: products,
  };
}
