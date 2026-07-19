# Test matrix

Run automated checks first:

```powershell
cd client; npm run lint; npm run test; npm run build
cd ../server; npm test
cd ..; cargo test --workspace; cargo build --workspace --release
```

Then run this manual testnet matrix against a dedicated Google account and TestMarket test account. Use only test XLM.

| Scenario | Steps | Expected safe result |
| --- | --- | --- |
| First sign-in | Sign in with Google, refresh, sign in again | Same managed wallet address and balance; no duplicate wallet |
| New chat recovery | Refresh the dashboard repeatedly | Reuses a blank draft; no duplicate blank chats |
| Store OAuth | Paste store URL, connect, sign in at merchant | Store appears once in right sidebar; scoped OAuth token is saved encrypted |
| Search | Ask for an item naturally with a budget/constraint | Agent uses authorized stores only, returns a product card, does not pay |
| Delivery details | Start checkout without profile data | Agent preserves selection and asks for missing details before checkout |
| Two-step approval | Select a result, then approve twice | First approval reserves/verifies checkout; second approves exact XLM total |
| Successful payment | Complete a valid checkout | Direct Agent Smart Wallet → merchant testnet payment, receipt, Explorer link, merchant order confirmed |
| Per-transaction cap | Set a low cap and approve a higher total | Contract rejects; no XLM leaves the smart wallet |
| Daily cap | Spend within a low daily cap, then attempt another purchase | Second transaction rejects; no extra XLM leaves wallet |
| Duplicate approval | Submit the same final approval twice | One accepted payment only; duplicate-intent protection prevents another |
| Expired checkout | Wait past selection TTL before approval | Agent asks to search again; no payment |
| Merchant outage | Simulate merchant confirm failure after payment | Payment is never repeated; durable reconciliation retries confirmation |
| OAuth lifecycle | Disconnect the store or revoke its merchant token | Store becomes unusable immediately; a new connect flow is required |
| Rate limiting | Send 10+ chat messages in one minute | At least 10 real message submissions succeed; reads do not consume that budget; 429 includes `Retry-After` |
| Mobile | Test at 360px, 768px, and desktop width | No horizontal overflow, all controls keyboard reachable, dialogs remain usable |

Record the transaction hash and corresponding merchant order ID for each successful test. Never add private keys, OAuth tokens, delivery addresses, or Google credentials to screenshots or issue reports.
