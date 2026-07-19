import { generateText, parseJsonResponse } from './llm.service.js';

/**
 * Rank merchant candidates by semantic fit to the user's stated need.
 * The LLM may choose only an indexed candidate and must explain trade-offs.
 *
 * LLM Call 2: Given products + user intent, rank and explain the best pick.
 */
export async function rankProducts(products, intent) {
  if (!products || products.length === 0) {
    return { bestMatch: null, reasoning: 'No products found matching your criteria.' };
  }

  const prompt = `You are a smart shopping assistant. The user wants: "${intent.rawQuery}"
${intent.maxPrice ? `Requested budget: max ${intent.currency || 'unspecified currency'} ${intent.maxPrice}. Catalog prices may use a different currency; never claim a product is within budget unless the displayed product currency matches. A budget in XLM is verified only from the merchant checkout total.` : ''}
${intent.mustHave?.length ? `Must have: ${intent.mustHave.join(', ')}` : ''}
${intent.preferences?.length ? `Nice to have: ${intent.preferences.join(', ')}` : ''}
${intent.exclusions?.length ? `Must avoid: ${intent.exclusions.join(', ')}` : ''}
${intent.useCases?.length ? `Primary use: ${intent.useCases.join(', ')}` : ''}

Here are the available products:
${JSON.stringify(products.map((p, i) => ({
  index: i,
  name: p.name,
  price: p.price,
  currency: p.currency || 'INR',
  description: p.description,
  brand: p.brand,
  rating: p.rating,
  inStock: p.inStock,
  semanticScore: p.semanticScore,
})), null, 2)}

Pick the BEST product for the user. Consider:
1. First reject candidates that conflict with a must-have, exclusion, or budget.
2. Compare meaning, use case, attributes, and product descriptions—not only overlapping words.
3. Prefer stronger ratings/value only after relevance.
4. Do not claim an attribute that is missing from the merchant data.
5. When at least two reasonable candidates exist, always return one or two distinct alternativeIndexes. Leave it empty only when no other candidate is genuinely relevant.

Respond with JSON:
{
  "bestIndex": <number or null when no candidate is suitable>,
  "alternativeIndexes": ["up to two distinct candidate indexes that are reasonable alternatives"],
  "matchQuality": <number from 0 to 1>,
  "reasoning": "<1-2 sentence explanation of why this is the best fit and any trade-off>",
  "unmetRequirements": ["<requirement not verified>"]
}`;

  let parsed = null;
  try {
    const response = await generateText(prompt, { jsonMode: true });
    parsed = parseJsonResponse(response);
  } catch (error) {
    console.warn('Semantic product ranking unavailable; no product will be selected:', error.message);
  }

  if (parsed?.bestIndex === null && typeof parsed.reasoning === 'string') {
    return { bestMatch: null, reasoning: parsed.reasoning, allProducts: products };
  }
  if (parsed && Number.isInteger(parsed.bestIndex) && parsed.bestIndex >= 0 && parsed.bestIndex < products.length && typeof parsed.reasoning === 'string') {
    const quality = Number(parsed.matchQuality);
    if (Number.isFinite(quality) && quality < 0.4) {
      return { bestMatch: null, reasoning: parsed.reasoning, allProducts: products };
    }
    return {
      bestMatch: products[parsed.bestIndex],
      reasoning: `${parsed.reasoning}${Array.isArray(parsed.unmetRequirements) && parsed.unmetRequirements.length ? ` Note: ${parsed.unmetRequirements.join(', ')} could not be verified.` : ''}`,
      alternatives: Array.isArray(parsed.alternativeIndexes) ? parsed.alternativeIndexes
        .filter((index) => Number.isInteger(index) && index >= 0 && index < products.length && index !== parsed.bestIndex)
        .slice(0, 2).map((index) => products[index]) : [],
      allProducts: products,
    };
  }

  return {
    bestMatch: null,
    reasoning: 'I could not complete semantic product evaluation right now, so I will not guess a product. Please try again shortly.',
    allProducts: products,
  };
}
