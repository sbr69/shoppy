# JarvisPayz Agent

JarvisPayz Agent is a testnet AI shopping application that lets users discover products from OAuth-authorized ecommerce stores, build a basket through chat, approve a merchant-verified XLM total, and pay directly from a policy-controlled Stellar smart wallet.

The project is currently designed for **Stellar testnet** and uses **test XLM only**.

## Live demo

[jarvispayz-agent.vercel.app](https://jarvispayz-agent.vercel.app/)

## Product overview

Users sign in to JarvisPayz and receive a persistent managed Agent Smart Wallet. After connecting an ecommerce store through its OAuth flow, they can use natural language to search the authorized catalog, compare relevant products, add items and quantities to a basket, and request checkout.

The merchant calculates the exact XLM total before payment. The user then approves that exact amount. The Agent Smart Wallet validates the merchant, transaction limit, daily limit, wallet balance, and purchase-intent uniqueness on Stellar before transferring XLM directly to the merchant. A confirmed purchase includes an invoice and a Stellar Explorer transaction link.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web application | React, Vite | Responsive chat workspace, wallet visibility, store connection, settings, invoices, and activity. |
| API and orchestration | Node.js, Express | Authentication, merchant OAuth, semantic shopping flow, basket/checkout state, custody, payment, and reconciliation. |
| Data layer | Supabase PostgreSQL | Durable user, session, store, checkout, purchase, reconciliation, and encrypted invoice data. |
| Smart contracts | Rust, Soroban | Merchant trust rules and direct policy-controlled wallet transfers. |
| Merchant integration | OAuth 2.0 + PKCE, agent-commerce APIs | Authorized catalog search, checkout preparation, payment confirmation, and order status. |
| Observability | Sentry, PostHog | Privacy-safe error monitoring and aggregate product analytics when configured. |

## Core safeguards

- OAuth-authorized stores only; JarvisPayz never receives a merchant password.
- Search and product recommendations never move funds.
- Checkout requires merchant verification of the exact final XLM amount.
- The user provides a final approval before payment.
- Each user has a dedicated Agent Smart Wallet; payment is direct to the authorized merchant, not escrowed.
- On-chain policy enforces merchant allowlisting, per-transaction limits, daily limits, balance checks, and duplicate-intent prevention.
- Merchant confirmation is reconciled durably without retrying an already submitted payment.
- Custodial signing keys, OAuth tokens, delivery profiles, and invoice snapshots are encrypted at rest.

## Stellar testnet contracts

| Contract | Deployment | Role |
| --- | --- | --- |
| TrustList | [`CCF7TJNLJUFTQYQSJH3BUBF6E6DPWGG4T6LIH5PVET4TJKOMNIHDEZKK`](https://stellar.expert/explorer/testnet/contract/CCF7TJNLJUFTQYQSJH3BUBF6E6DPWGG4T6LIH5PVET4TJKOMNIHDEZKK) | Shared merchant trust and spending-policy rules. |
| SpendGuard | [`CCM46FWI7N43QETVUQUS5QPIGCOEKIF4IKHEO2XNPIQGMMJC2FAARNMO`](https://stellar.expert/explorer/testnet/contract/CCM46FWI7N43QETVUQUS5QPIGCOEKIF4IKHEO2XNPIQGMMJC2FAARNMO) | Legacy policy contract retained for compatibility; not the current direct-payment route. |
| Agent Smart Wallet | Per-user `C...` contract address | Holds test XLM and performs the live direct merchant-payment flow. Each user’s address is available in the dashboard wallet panel. |

## Submission evidence

### Product UI

<!-- Add the final desktop dashboard screenshot here. -->

![Product UI screenshot — pending](docs/evidence/dashboard-desktop.png)

### Mobile responsive design

<!-- Add the final mobile dashboard screenshot here. -->

![Mobile responsive screenshot — pending](docs/evidence/dashboard-mobile.png)

### Monitoring and analytics

<!-- Add a redacted Sentry or PostHog dashboard screenshot here. -->

![Monitoring and analytics screenshot — pending](docs/evidence/observability.png)

### Demo video

`ADD_DEMO_VIDEO_LINK_HERE`

### Proof of 10+ user wallet interactions

Each completed interaction should link to Stellar Expert using the associated user Agent Smart Wallet transaction hash.

| # | Interaction | Transaction hash | Result |
| --- | --- | --- | --- |
| 1 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 2 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 3 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 4 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 5 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 6 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 7 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 8 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 9 | Pending | `ADD_TRANSACTION_HASH` | Pending |
| 10 | Pending | `ADD_TRANSACTION_HASH` | Pending |

Transaction links use this format:

`https://stellar.expert/explorer/testnet/tx/TRANSACTION_HASH`

### Basic user-feedback summary

| Measure | Summary |
| --- | --- |
| Participants | `ADD_PARTICIPANT_COUNT` |
| Test scenarios | `ADD_TEST_SCENARIOS` |
| Positive findings | `ADD_SUMMARY` |
| Improvements identified | `ADD_SUMMARY` |
| Follow-up status | `ADD_STATUS` |

## Project status

JarvisPayz is a functional testnet MVP with a deployed Stellar policy layer, managed smart wallets, merchant OAuth, agent-driven shopping, direct guarded payments, invoices, durable reconciliation, monitoring hooks, and analytics hooks. It is not a real-money or mainnet product.

## Documentation

- [Product requirements](PRD.md)
- [System architecture and blockchain migration guide](architecture.md)
- [Privacy and telemetry boundaries](docs/PRIVACY.md)
- [Test coverage and validation matrix](docs/TESTING.md)
