import { createHash } from 'crypto';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { EcommerceAdapter } from './adapters/ecommerce.adapter.js';
import { buildReceiptMemo } from './receipt.service.js';
import { markIntentState } from './policy.service.js';
import { prepareGuardedSpend, submitGuardedSpend, submitAgentSmartWalletSpend, getSorobanTransactionStatus } from './soroban.service.js';
import { recordWorkflowEvent } from './workflow.service.js';
import { getAgentKeypairForSigning, getAgentSmartWalletByUserId, getAgentWalletByUserId, getOwnerKeypairForSigning, getWalletByUserId } from './wallet.service.js';

const reconciliationWorkerId = `${process.env.RECONCILIATION_WORKER_ID || process.env.HOSTNAME || 'api'}-${process.pid}`;
export const reconciliationRetryDelayMs = (attempt) => Math.min(15 * 60_000, Math.max(10_000, 10_000 * (2 ** Math.min(Math.max(attempt - 1, 0), 7))));
const boundedError = (error) => String(error?.message || 'Merchant confirmation pending').replace(/[\r\n]+/g, ' ').slice(0, 500);

function receiptFor(purchaseIntent, site, product) {
  return {
    purchaseIntentId: purchaseIntent.id,
    merchantOrderId: purchaseIntent.merchant_order_id,
    productName: product.name,
    priceXlm: Number(purchaseIntent.price_xlm),
    currency: 'XLM',
    merchant: site.merchant_stellar_address,
    timestamp: new Date().toISOString(),
  };
}

export async function preparePurchaseApproval(userId, purchaseIntent, site, product) {
  const amount = Number(purchaseIntent.price_xlm);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid verified payment amount');
  const [ownerWallet, agentWallet] = await Promise.all([
    getWalletByUserId(userId),
    getAgentWalletByUserId(userId),
  ]);
  if (!ownerWallet?.public_key || ownerWallet.status !== 'active') throw new Error('Set up your passkey vault before approving a purchase');
  if (!agentWallet?.public_key || agentWallet.status !== 'active') throw new Error('The constrained agent signer is unavailable');

  const receiptData = receiptFor(purchaseIntent, site, product);
  const receiptHash = buildReceiptMemo(receiptData);
  const receiptHashHex = receiptHash.toString('hex');
  const intentHash = createHash('sha256').update(purchaseIntent.id).digest('hex');
  const prepared = await prepareGuardedSpend({
    ownerPublicKey: ownerWallet.public_key,
    agentPublicKey: agentWallet.public_key,
    merchant: site.merchant_stellar_address,
    domainHashHex: site.merchant_domain_hash,
    amountXlm: amount,
    intentHashHex: intentHash,
    receiptHash,
  });
  const summary = {
    product: { name: product.name, image: product.image || null, url: product.url || null },
    merchant: { siteId: site.id, siteName: site.site_name, address: site.merchant_stellar_address, orderId: purchaseIntent.merchant_order_id },
    amountXlm: amount,
    quantity: purchaseIntent.quantity,
    receiptData,
    receiptHash: receiptHashHex,
    intentHash,
  };
  const db = getDb();
  const [approval] = await db`
    insert into purchase_approvals (user_id, purchase_intent_id, owner_public_key, agent_public_key, expected_auth_entry_xdr, prepared_transaction_xdr, valid_until_ledger_seq, approval_summary, expires_at)
    values (${userId}, ${purchaseIntent.id}, ${ownerWallet.public_key}, ${agentWallet.public_key}, ${prepared.authorizationEntryXdr}, ${prepared.transactionXdr}, ${prepared.validUntilLedgerSeq}, ${db.json(summary)}, ${prepared.expiresAt})
    on conflict (purchase_intent_id) do update set expected_auth_entry_xdr = excluded.expected_auth_entry_xdr,
      prepared_transaction_xdr = excluded.prepared_transaction_xdr, valid_until_ledger_seq = excluded.valid_until_ledger_seq,
      approval_summary = excluded.approval_summary, expires_at = excluded.expires_at, state = 'prepared', authorized_at = null, submitted_tx_hash = null, submitted_at = null
    returning id, expires_at`;
  await markIntentState(purchaseIntent.id, 'approval_required');
  await db`insert into audit_events (user_id, purchase_intent_id, event_type, payload) values (${userId}, ${purchaseIntent.id}, 'purchase_approval_prepared', ${db.json({ approvalId: approval.id, amountXlm: amount, merchantOrderId: purchaseIntent.merchant_order_id })})`;
  return {
    approvalId: approval.id,
    authorizationEntryXdr: prepared.authorizationEntryXdr,
    validUntilLedgerSeq: prepared.validUntilLedgerSeq,
    expiresAt: approval.expires_at,
    summary,
  };
}

async function claimApprovalForSubmission(userId, approvalId) {
  return getDb().begin(async (tx) => {
    const [approval] = await tx`
      select pa.*, pi.site_id, pi.session_id, pi.product_json, pi.merchant_order_id, pi.idempotency_key
      from purchase_approvals pa join purchase_intents pi on pi.id = pa.purchase_intent_id
      where pa.id = ${approvalId} and pa.user_id = ${userId} for update`;
    if (!approval) throw new Error('Purchase approval not found');
    if (!['prepared', 'authorized'].includes(approval.state)) {
      throw new Error('This purchase approval has already been used or is no longer valid');
    }
    if (new Date(approval.expires_at).getTime() <= Date.now()) {
      await tx`update purchase_approvals set state = 'expired' where id = ${approval.id}`;
      await tx`update purchase_intents set state = 'expired', reserved_xlm = 0, updated_at = now() where id = ${approval.purchase_intent_id}`;
      throw new Error('This purchase approval expired. Re-checkout before approving again.');
    }
    if (approval.state === 'prepared') {
      await tx`update purchase_approvals set state = 'authorized', authorized_at = now() where id = ${approval.id}`;
    }
    return approval;
  });
}

export async function submitPurchaseApproval(userId, googleSub, approvalId, signedAuthorizationEntryXdr) {
  if (typeof signedAuthorizationEntryXdr !== 'string' || signedAuthorizationEntryXdr.length > 40_000) {
    throw new Error('Invalid owner authorization payload');
  }
  const approval = await claimApprovalForSubmission(userId, approvalId);
  const [site] = await getDb()`select * from connected_sites where id = ${approval.site_id} and user_id = ${userId} and status = 'active'`;
  if (!site) {
    await getDb()`update purchase_approvals set state = 'failed' where id = ${approval.id}`;
    throw new Error('The connected store is no longer active');
  }
  const agentKeypair = await getAgentKeypairForSigning(userId, googleSub);
  let submitted;
  try {
    submitted = await submitGuardedSpend({
      preparedTransactionXdr: approval.prepared_transaction_xdr,
      expectedAuthorizationEntryXdr: approval.expected_auth_entry_xdr,
      signedAuthorizationEntryXdr,
      ownerPublicKey: approval.owner_public_key,
      agentKeypair,
      validUntilLedgerSeq: approval.valid_until_ledger_seq,
    });
  } catch (error) {
    const indeterminate = /timeout|network|fetch/i.test(error.message);
    await getDb()`update purchase_approvals set state = ${indeterminate ? 'authorized' : 'failed'} where id = ${approval.id}`;
    error.indeterminate = indeterminate;
    throw error;
  }

  const summary = approval.approval_summary;
  const product = approval.product_json;
  const db = getDb();
  const [purchase] = await db`
    insert into purchases (user_id, site_id, purchase_intent_id, product_name, product_url, product_image, price_xlm, stellar_tx_hash, receipt_memo_hash, status)
    values (${userId}, ${site.id}, ${approval.purchase_intent_id}, ${product.name}, ${product.url || null}, ${product.image || null}, ${summary.amountXlm}, ${submitted.txHash}, ${summary.receiptHash}, 'pending')
    on conflict (purchase_intent_id) do update set stellar_tx_hash = excluded.stellar_tx_hash
    returning *`;
  await db.begin(async (tx) => {
    await tx`update purchase_approvals set state = 'submitted', submitted_tx_hash = ${submitted.txHash}, submitted_at = now() where id = ${approval.id}`;
    await tx`update purchase_intents set state = 'payment_submitted', policy_tx_hash = ${submitted.txHash}, updated_at = now() where id = ${approval.purchase_intent_id}`;
    await tx`insert into audit_events (user_id, purchase_intent_id, event_type, payload) values (${userId}, ${approval.purchase_intent_id}, 'purchase_payment_submitted', ${tx.json({ approvalId, txHash: submitted.txHash })})`;
  });

  let orderId = approval.merchant_order_id;
  let merchantConfirmed = false;
  if (submitted.final) {
    try {
      const confirmation = await new EcommerceAdapter(site).confirmPayment(orderId, submitted.txHash, approval.idempotency_key);
      orderId = confirmation.orderId || orderId;
      merchantConfirmed = true;
      await db`update purchases set status = 'confirmed', confirmed_at = now() where id = ${purchase.id}`;
      await markIntentState(approval.purchase_intent_id, 'order_confirmed', { reserved_xlm: 0 });
    } catch (error) {
      // The on-chain payment has a final success. Never re-run it merely
      // because a merchant callback is temporarily unavailable.
      await markIntentState(approval.purchase_intent_id, 'payment_confirmed');
    }
  }

  const explorerNetwork = config.stellarNetwork === 'mainnet' ? 'public' : 'testnet';
  const result = {
    success: merchantConfirmed,
    pendingMerchantConfirmation: !merchantConfirmed,
    purchaseId: purchase.id,
    txHash: submitted.txHash,
    priceXlm: Number(summary.amountXlm),
    orderId,
    product,
    explorerUrl: `https://stellar.expert/explorer/${explorerNetwork}/tx/${submitted.txHash}`,
    receiptData: summary.receiptData,
    memoHash: summary.receiptHash,
    finality: submitted.finalStatus,
  };
  await db`insert into messages (session_id, role, content, metadata) values (${approval.session_id}, 'agent', ${merchantConfirmed ? `Purchase complete. The merchant confirmed order ${orderId}.` : 'Payment was submitted to SpendGuard. Merchant confirmation is pending; do not pay again.'}, ${db.json({ product, purchase: result })})`;
  return result;
}

export async function getPurchaseHistory(userId) {
  return getDb()`select p.*, cs.site_name, pi.merchant_order_id, pi.state as intent_state,
    r.run_after as reconciliation_run_after, r.attempts as reconciliation_attempts, r.last_error as reconciliation_error
    from purchases p
    left join connected_sites cs on p.site_id = cs.id
    left join purchase_intents pi on pi.id = p.purchase_intent_id
    left join reconciliation_jobs r on r.purchase_id = p.id
    where p.user_id = ${userId} order by p.created_at desc`;
}

export async function executeCustodialPayment(userId, googleSub, purchaseIntent, site, product) {
  const amount = Number(purchaseIntent.price_xlm);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid verified payment amount');
  const [smartWallet, ownerWallet, ownerKeypair, agentKeypair] = await Promise.all([
    getAgentSmartWalletByUserId(userId),
    getWalletByUserId(userId),
    getOwnerKeypairForSigning(userId, googleSub),
    getAgentKeypairForSigning(userId, googleSub),
  ]);
  if (!smartWallet?.contract_id || smartWallet.status !== 'active') throw new Error('Agent Smart Wallet is not ready. Fund your wallet before approving a purchase.');
  if (!ownerWallet?.public_key || ownerWallet.status !== 'active') throw new Error('Custodial owner authorization is unavailable');
  const receiptData = receiptFor(purchaseIntent, site, product);
  const receiptHash = buildReceiptMemo(receiptData);
  const submitted = await submitAgentSmartWalletSpend({
    smartWalletId: smartWallet.contract_id,
    ownerKeypair,
    ownerPublicKey: ownerWallet.public_key,
    agentKeypair,
    merchant: site.merchant_stellar_address,
    domainHashHex: site.merchant_domain_hash,
    amountXlm: amount,
    intentHashHex: createHash('sha256').update(purchaseIntent.id).digest('hex'),
    receiptHash,
  });
  const [purchase] = await getDb()`insert into purchases (user_id, site_id, purchase_intent_id, product_name, product_url, product_image, price_xlm, stellar_tx_hash, receipt_memo_hash, status) values (${userId}, ${site.id}, ${purchaseIntent.id}, ${product.name}, ${product.url || null}, ${product.image || null}, ${amount}, ${submitted.txHash}, ${receiptHash.toString('hex')}, ${submitted.final ? 'payment_confirmed' : 'pending'}) on conflict (purchase_intent_id) do update set stellar_tx_hash = excluded.stellar_tx_hash returning *`;
  await markIntentState(purchaseIntent.id, submitted.final ? 'payment_confirmed' : 'payment_submitted', { policy_tx_hash: submitted.txHash });
  await getDb()`insert into audit_events (user_id, purchase_intent_id, event_type, payload) values (${userId}, ${purchaseIntent.id}, 'custodial_payment_submitted', ${getDb().json({ txHash: submitted.txHash, amountXlm: amount })})`;

  // A Stellar success is not yet a merchant order. The merchant creates the
  // order only after it verifies this exact transaction hash. If its callback
  // is temporarily unavailable, keep the payment safely retryable; never send
  // a second on-chain payment merely to obtain an order record.
  let merchantConfirmed = false;
  let orderId = purchaseIntent.merchant_order_id;
  if (submitted.final) {
    try {
      const confirmation = await new EcommerceAdapter(site).confirmPayment(orderId, submitted.txHash, purchaseIntent.idempotency_key);
      orderId = confirmation.orderId || orderId;
      merchantConfirmed = true;
      await getDb()`update purchases set status = 'confirmed', confirmed_at = now() where id = ${purchase.id}`;
      await markIntentState(purchaseIntent.id, 'order_confirmed', { reserved_xlm: 0 });
    } catch (error) {
      await recordWorkflowEvent({
        userId,
        sessionId: purchaseIntent.session_id,
        purchaseIntentId: purchaseIntent.id,
        stage: 'reconciliation',
        status: 'pending',
        detail: `Merchant confirmation pending: ${error.message}`,
        metadata: { txHash: submitted.txHash },
      });
    }
  }

  return {
    success: merchantConfirmed,
    pendingMerchantConfirmation: submitted.final && !merchantConfirmed,
    purchaseId: purchase.id,
    txHash: submitted.txHash,
    walletAddress: smartWallet.contract_id,
    priceXlm: amount,
    orderId,
    receiptData,
    timestamp: receiptData.timestamp,
    explorerUrl: `https://stellar.expert/explorer/${config.stellarNetwork === 'mainnet' ? 'public' : 'testnet'}/tx/${submitted.txHash}`,
    memoHash: receiptHash.toString('hex'),
  };
}

/**
 * Idempotent reconciliation worker. It never resubmits a payment; it only
 * observes finality and then retries the merchant confirmation callback.
 */
export async function reconcilePendingPurchases(limit = 25) {
  const db = getDb();
  const jobs = await db`select * from claim_reconciliation_jobs(${reconciliationWorkerId}, ${limit})`;
  let reconciled = 0;
  for (const job of jobs) {
    try {
      const [purchase] = await db`select p.*, cs.site_url, cs.site_name, cs.adapter_id, cs.agent_manifest, cs.auth_token_ciphertext, cs.auth_token_iv, cs.auth_token_tag, cs.oauth_client_ciphertext, cs.oauth_client_iv, cs.oauth_client_tag, cs.oauth_server_metadata, cs.merchant_stellar_address, cs.merchant_domain_hash, cs.status as site_status, pi.session_id, pi.idempotency_key, pi.merchant_order_id from purchases p join connected_sites cs on cs.id = p.site_id join purchase_intents pi on pi.id = p.purchase_intent_id where p.id = ${job.purchase_id}`;
      if (!purchase || !['pending', 'payment_confirmed'].includes(purchase.status) || !purchase.stellar_tx_hash) {
        await db`select complete_reconciliation_job(${job.job_id})`;
        continue;
      }
      const finality = await getSorobanTransactionStatus(purchase.stellar_tx_hash);
      if (finality === 'FAILED') {
        await db`update purchases set status = 'failed' where id = ${purchase.id} and status in ('pending', 'payment_confirmed')`;
        await markIntentState(purchase.purchase_intent_id, 'failed', { reserved_xlm: 0 });
        await recordWorkflowEvent({ userId: purchase.user_id, sessionId: purchase.session_id, purchaseIntentId: purchase.purchase_intent_id, stage: 'reconciliation', status: 'failed', detail: 'Soroban reported a failed transaction.', metadata: { txHash: purchase.stellar_tx_hash } });
        await db`select complete_reconciliation_job(${job.job_id})`;
        reconciled += 1;
        continue;
      }
      if (finality !== 'SUCCESS') {
        const detail = `Stellar transaction is ${String(finality).toLowerCase()}; waiting for finality.`;
        await db`select reschedule_reconciliation_job(${job.job_id}, ${new Date(Date.now() + reconciliationRetryDelayMs(job.attempt)).toISOString()}, ${detail})`;
        await recordWorkflowEvent({ userId: purchase.user_id, sessionId: purchase.session_id, purchaseIntentId: purchase.purchase_intent_id, stage: 'reconciliation', status: 'pending', detail, metadata: { txHash: purchase.stellar_tx_hash, attempt: job.attempt } });
        continue;
      }
      // The purchase row and connected-site row have different primary keys.
      // Build the adapter input with the connected-site id, credentials, and
      // manifest rather than accidentally using the purchase id.
      const site = { ...purchase, id: purchase.site_id, status: purchase.site_status };
      const confirmation = await new EcommerceAdapter(site).confirmPayment(purchase.merchant_order_id, purchase.stellar_tx_hash, purchase.idempotency_key);
      await db`update purchases set status = 'confirmed', confirmed_at = now() where id = ${purchase.id}`;
      await markIntentState(purchase.purchase_intent_id, 'order_confirmed', { reserved_xlm: 0 });
      await recordWorkflowEvent({ userId: purchase.user_id, sessionId: purchase.session_id, purchaseIntentId: purchase.purchase_intent_id, stage: 'reconciliation', status: 'completed', detail: `Merchant order ${confirmation.orderId || purchase.merchant_order_id} confirmed.`, metadata: { txHash: purchase.stellar_tx_hash } });
      await db`select complete_reconciliation_job(${job.job_id})`;
      reconciled += 1;
    } catch (error) {
      // A merchant outage must never trigger another payment. The durable job
      // is released with exponential backoff and can be claimed by any API
      // instance or external scheduler after a restart.
      const detail = boundedError(error);
      await db`select reschedule_reconciliation_job(${job.job_id}, ${new Date(Date.now() + reconciliationRetryDelayMs(job.attempt)).toISOString()}, ${detail})`;
      const [purchase] = await db`select p.user_id, p.purchase_intent_id, pi.session_id, p.status from purchases p join purchase_intents pi on pi.id = p.purchase_intent_id where p.id = ${job.purchase_id}`;
      if (purchase?.status === 'confirmed' || purchase?.status === 'failed') {
        await db`select complete_reconciliation_job(${job.job_id})`;
      } else if (purchase) {
        await recordWorkflowEvent({ userId: purchase.user_id, sessionId: purchase.session_id, purchaseIntentId: purchase.purchase_intent_id, stage: 'reconciliation', status: 'pending', detail: `Retry pending: ${detail}`, metadata: { attempt: job.attempt } });
      }
    }
  }
  return { examined: jobs.length, reconciled, workerId: reconciliationWorkerId };
}
