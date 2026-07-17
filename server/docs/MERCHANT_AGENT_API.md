# Merchant Agent API contract

JarvisPayz does not scrape checkout pages or pay arbitrary URLs. A connected
merchant must expose the following authenticated HTTPS endpoints. This prevents
the agent from sending Stellar funds before a real merchant order exists.

## Authentication

Use OAuth 2.0 authorization code flow with PKCE (or an equivalent
merchant-controlled delegated token). Tokens must be scoped to the logged-in
customer and the four endpoints below. The merchant must reject an expired or
revoked token.

The store registration in `SUPPORTED_STORES_JSON` must contain its immutable
origin, API origin, adapter ID, and Stellar testnet receiving address. The
address returned by checkout must exactly match the registered address.

## `GET /api/agent/products?q=<query>&maxPrice=<number>&minPrice=<number>`

Return only in-stock products that the connected customer may purchase:

```json
{
  "products": [{
    "id": "sku_earbuds_black",
    "name": "Wireless Earbuds",
    "price": 1499,
    "currency": "INR",
    "description": "…",
    "image": "https://shop.example/products/earbuds.png",
    "url": "https://shop.example/products/earbuds",
    "rating": 4.5,
    "inStock": true
  }]
}
```

## `POST /api/agent/checkout/prepare`

Accept an `Idempotency-Key` header and JSON `{ "productId": "…", "quantity": 1 }`.
It must validate stock and create a short-lived, unpaid order reservation. Return:

```json
{
  "orderId": "order_123",
  "xlmAmount": "2.5000000",
  "merchantStellarAddress": "G…",
  "currency": "XLM",
  "expiresAt": "2026-07-17T12:00:00.000Z",
  "displayTotal": { "amount": 1499, "currency": "INR", "tax": 0, "shipping": 0 }
}
```

The merchant, not JarvisPayz, is responsible for its INR/XLM quote and quote
expiry. The order must not be fulfilled until payment is confirmed.

## `POST /api/agent/checkout/confirm-payment`

Accept the same idempotency key and JSON:

```json
{ "orderId": "order_123", "stellarTransactionHash": "…" }
```

Verify on Stellar testnet that the transaction succeeded, paid the registered
address the exact quoted amount, and was not reused for a different order.
Return `{ "status": "confirmed", "orderId": "order_123" }` only after the
merchant has committed the order. Otherwise return a non-2xx response without
fulfilling anything.

## Failure handling

The merchant must expose order-status and refund/cancel endpoints in its real
integration. If a payment succeeds but confirmation times out, JarvisPayz locks
the purchase intent and tells the user not to pay again; support can reconcile
the transaction hash against the merchant order.
