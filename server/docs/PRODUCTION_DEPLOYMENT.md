# Production deployment

This application uses Supabase PostgreSQL and Soroban as the payment
authority. Owner Stellar keys are created and encrypted in the browser with a
WebAuthn PRF-capable passkey; the server never receives an owner secret.

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
Asset Contract ID for native XLM on the same network. On testnet, calculate it
with `stellar contract id asset --asset native --network testnet`.

## 3. Configure the runtime

Start from `.env.example`, generate new high-entropy `JWT_SECRET` and
`MASTER_SECRET`, and set `NODE_ENV=production`. Configure a mainnet Horizon
endpoint, a Soroban RPC endpoint, and the matching mainnet network passphrase.
Set `PASSKEY_RP_ID` to the dashboard hostname and `PASSKEY_ORIGIN` to its
exact HTTPS origin. Synced passkeys must support the WebAuthn PRF extension;
the dashboard blocks vault setup if PRF is unavailable.

Keep secrets in the hosting platform's secret manager. `MASTER_SECRET`
encrypts only the separate backend agent signer; it is not capable of
decrypting an owner wallet. Use KMS/HSM-backed storage for the agent signer in
any real-money deployment and rotate it through the `key_version` columns.

## 4. User activation path

After merchant OAuth succeeds:

1. The dashboard creates a browser-only owner key and passkey-encrypts it.
2. The user funds the public testnet address and selects **Authorize
   constrained agent**. The browser passkey-signs `SpendGuard.set_agent`.
3. For each merchant, select **Sync on-chain rule**. The browser
   passkey-signs `TrustList.set_rule` with that store's exact caps.
4. Deposit to SpendGuard through `POST /api/wallet/actions/prepare` with
   `actionType: "deposit"`; the browser signs the exact returned transaction
   and relays it to `/api/wallet/actions/:id/submit`.

Each payment requires both signatures. The browser signs a fresh
`SorobanAuthorizationEntry` over the exact merchant, amount, intent hash and
receipt hash, and the backend adds only its constrained agent signature. The
contract checks the domain commitment, merchant address, per-transaction cap,
UTC-day cap, duplicate intent hash, and escrow balance before transferring the
settlement asset. The SHA-256 receipt commitment is present in both the Stellar
`Memo.hash` and the `purchased` Soroban event.

## Operational requirements

- Add a durable webhook/reconciliation worker that polls each submitted
  Soroban transaction and only marks the merchant order confirmed after final
  success. The persisted approval state prevents an automatic duplicate spend
  while this worker is being added.
- Persist merchant OAuth tokens only encrypted; the schema has ciphertext,
  IV, and authentication-tag columns for this integration.
- Use an external Redis-compatible rate limiter and queue for multi-instance
  deployments; the current in-memory limiter is not cluster-safe.
- Obtain an independent smart-contract audit and run integration tests on
  testnet before configuring mainnet contract IDs.
