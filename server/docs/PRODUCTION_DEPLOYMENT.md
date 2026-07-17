# Production deployment

This application now uses Supabase PostgreSQL and Soroban as the payment
authority. It will deliberately refuse to start in production without its
database and contract configuration.

## 1. Provision Supabase

Create a Supabase project, then link this repository and apply the migration:

```powershell
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

Copy the **transaction pooler** connection string (port `6543`) into the
server's `SUPABASE_DB_URL`. Never use the anon key or expose this URL in Vite.
The migration enables RLS and revokes browser table access; the Express API is
the only data path.

## 2. Build and deploy contracts

Build the reviewed contract workspace:

```powershell
stellar contract build
```

Upload and deploy `jarvis_trust_list.wasm`, then `jarvis_spend_guard.wasm` to
your target network with a dedicated deployer account. Initialize once:

```powershell
stellar contract invoke --id <trust-list-id> --source <deployer> --network <network> -- initialize
stellar contract invoke --id <spend-guard-id> --source <deployer> --network <network> -- initialize --token <native-xlm-sac-id> --trust_list <trust-list-id>
```

Set `TRUSTLIST_CONTRACT_ID`, `SPENDGUARD_CONTRACT_ID`, and
`SETTLEMENT_TOKEN_CONTRACT_ID` in the server environment. Use the Stellar
Asset Contract ID for native XLM on the same network.

## 3. Configure the runtime

Start from `.env.example`, generate new high-entropy `JWT_SECRET` and
`MASTER_SECRET`, and set `NODE_ENV=production`. Configure a mainnet Horizon
endpoint, a Soroban RPC endpoint, and the matching mainnet network passphrase.

Keep secrets in the hosting platform's secret manager. A production deployment
should use a KMS/HSM-backed implementation for wallet encryption before it
holds real customer funds; `MASTER_SECRET` is an application-level interim key
and must be rotated using the `key_version` columns.

## 4. User activation path

After merchant OAuth succeeds, call:

1. `POST /api/sites/:id/policy/sync` — owner-signed `set_agent` and
   `TrustList.set_rule` calls.
2. `POST /api/wallet/escrow/deposit` — owner-signed deposit into SpendGuard.

The agent signs only `SpendGuard.spend` from its separate per-user agent key.
The contract checks the domain commitment, merchant address, per-transaction
cap, UTC-day cap, duplicate intent hash, and escrow balance before transferring
the settlement asset. The SHA-256 receipt commitment is present in both the
Stellar `Memo.hash` and the `purchased` Soroban event.

## Operational requirements

- Add a webhook/reconciliation worker that polls each submitted Soroban
  transaction and only marks the merchant order confirmed after final success.
- Persist merchant OAuth tokens only encrypted; the schema has ciphertext,
  IV, and authentication-tag columns for this integration.
- Use an external Redis-compatible rate limiter and queue for multi-instance
  deployments; the current in-memory limiter is not cluster-safe.
- Obtain an independent smart-contract audit and run integration tests on
  testnet before configuring mainnet contract IDs.
