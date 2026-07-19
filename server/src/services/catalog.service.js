import { createHash } from 'crypto';
import getDb from '../db/database.js';
import { embedText } from './llm.service.js';

const productText = (product) => [
  product.name,
  product.brand,
  product.category,
  product.description,
  ...(Array.isArray(product.tags) ? product.tags : []),
  ...(Array.isArray(product.attributes) ? product.attributes : []),
].filter(Boolean).map(String).join(' | ').slice(0, 7000);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const dot = (a, b) => a.length === b.length ? a.reduce((total, value, index) => total + value * b[index], 0) : -1;

/** Cache only products already returned through an authorized merchant API. */
export async function cacheAuthorizedProducts(siteId, products) {
  const db = getDb();
  await Promise.all(products.slice(0, 80).map(async (product) => {
    const searchableText = productText(product);
    const contentHash = hash(JSON.stringify({ product, searchableText }));
    const [previous] = await db`select content_hash, embedding from catalog_products where site_id = ${siteId} and merchant_product_id = ${String(product.id)}`;
    const embedding = previous?.content_hash === contentHash ? previous.embedding : await embedText(searchableText, 'RETRIEVAL_DOCUMENT');
    await db`
      insert into catalog_products (site_id, merchant_product_id, product_json, searchable_text, content_hash, embedding, last_seen_at)
      values (${siteId}, ${String(product.id)}, ${db.json(product)}, ${searchableText}, ${contentHash}, ${embedding ? db.json(embedding) : null}, now())
      on conflict (site_id, merchant_product_id) do update set
        product_json = excluded.product_json, searchable_text = excluded.searchable_text,
        content_hash = excluded.content_hash, embedding = excluded.embedding,
        last_seen_at = now(), updated_at = now()`;
  }));
}

/** Hybrid retrieval: merchant API is authoritative; this enriches it with prior authorized catalog knowledge. */
export async function retrieveSemanticCandidates(siteIds, intent) {
  if (!siteIds.length) return [];
  const queryText = [intent.product, ...(intent.mustHave || []), ...(intent.preferences || []), ...(intent.useCases || []), ...(intent.exclusions || []).map((value) => `not ${value}`)].filter(Boolean).join(' | ');
  const queryEmbedding = await embedText(queryText, 'RETRIEVAL_QUERY');
  if (!queryEmbedding) return [];
  const db = getDb();
  const rows = await db`select site_id, product_json, embedding from catalog_products where site_id in ${db(siteIds)} and embedding is not null and last_seen_at > now() - interval '7 days' limit 400`;
  return rows
    .map((row) => ({ ...row.product_json, siteId: row.site_id, semanticScore: dot(queryEmbedding, row.embedding || []) }))
    .filter((product) => product.semanticScore >= 0.38 && product.inStock && (!intent.maxPrice || Number(product.price) <= intent.maxPrice) && (!intent.minPrice || Number(product.price) >= intent.minPrice))
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, 24);
}
