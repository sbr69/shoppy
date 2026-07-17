import { createHash } from 'crypto';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { EcommerceAdapter } from './adapters/ecommerce.adapter.js';
import { buildReceiptMemo } from './receipt.service.js';
import { markIntentState } from './policy.service.js';
import { prepareGuardedSpend, submitGuardedSpend } from './soroban.service.js';
import { getAgentKeypairForSigning, getAgentWalletByUserId, getWalletByUserId } from './wallet.service.js';

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
  return getDb()`select p.*, cs.site_name from purchases p left join connected_sites cs on p.site_id = cs.id where p.user_id = ${userId} order by p.created_at desc`;
}
