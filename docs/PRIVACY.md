# Telemetry privacy contract

## Default state

Sentry and PostHog are disabled until their environment variables are set. Their absence never blocks login, chat, merchant OAuth, wallet funding, checkout, payment, or reconciliation.

## What may be recorded

Only bounded aggregate events such as:

- sign-in/sign-out completed
- agent message submitted and response type
- store connection started
- test wallet funding requested/completed
- payment confirmed, pending, or failed
- server error route/status and pseudonymous internal user ID

## What is explicitly excluded

- chat messages and prompts
- product names, prices, XLM amounts, transaction hashes, wallet addresses
- Google identity fields, email, name, avatar
- OAuth access/refresh tokens and merchant credentials
- delivery addresses, telephone numbers, and payment data
- request bodies, headers, and cookies
- session replay, autocapture, and performance capture

If new telemetry is added, preserve this contract and update its tests before enabling it.
