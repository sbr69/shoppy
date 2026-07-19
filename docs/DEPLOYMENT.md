# Testnet deployment guide

## Deployment boundary

This application is a testnet beta, not a mainnet payment product. Deploy it only after the local verification matrix passes. A real-money launch needs independent smart-contract, custody, threat-model, legal, and operational reviews.

## Required services

1. **Supabase Postgres** — apply `supabase/migrations` with `npx supabase db push`.
2. **Always-on Node API** — required for Google verification, OAuth callbacks, encrypted custody operations, and durable reconciliation. Use a service that can keep the API alive; serverless-only deployments are not suitable for the in-process worker.
3. **Static React host** — deploy the Vite `client/dist` build.
4. **Google Cloud OAuth** — register both deployed client origin and `${SERVER_PUBLIC_URL}/api/sites/oauth/callback` where required by merchant OAuth.
5. **Stellar testnet configuration** — configure the deployed TrustList, Agent Smart Wallet WASM hash, native XLM contract, and merchant registry values only in server-side secrets.

## Required server secrets

Set these through the host’s secret manager, never in source control:

- `SUPABASE_DB_URL`
- `JWT_SECRET` and `MASTER_SECRET` (different, high-entropy values)
- `GOOGLE_CLIENT_ID`, `GEMINI_API_KEY`
- `CLIENT_URL`, `SERVER_PUBLIC_URL`
- `TRUSTLIST_CONTRACT_ID`, `AGENT_WALLET_WASM_HASH`, `SETTLEMENT_TOKEN_CONTRACT_ID`
- `SUPPORTED_STORES_JSON`, including merchant OAuth credentials

Optional free-tier observability:

- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`
- `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`

## Pre-publication checks

- `NODE_ENV=production` starts cleanly and rejects default JWT/master secrets.
- HTTPS is enforced for `SERVER_PUBLIC_URL`.
- CORS allows only the deployed client origin.
- Google OAuth origins/redirects match the public URLs exactly.
- Run one successful testnet purchase and every rejection case in the test matrix.
- Confirm Sentry/PostHog configurations do not contain sensitive event fields.
- Set an uptime check on `/api/health` and a recurring review for unfinished reconciliation jobs.

## Free-tier note

Free plans are appropriate for controlled testnet demonstrations only. They can sleep, pause, have quotas, and often exclude commercial usage. Do not claim high availability or use the free deployment as a real-money service.
