import { createHash } from 'crypto';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { getAgentKeypairForSigning, getWalletByUserId } from './wallet.service.js';
import { buildReceiptMemo } from './receipt.service.js';
import { markIntentState } from './policy.service.js';
import { submitGuardedSpend } from './soroban.service.js';

export async function executePayment(userId, googleSub, purchaseIntent, site, product) {
  const amount = Number(purchaseIntent.price_xlm);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid verified payment amount');
  const ownerWallet = await getWalletByUserId(userId);
  if (!ownerWallet) throw new Error('Owner wallet not found');
  const agentKeypair = await getAgentKeypairForSigning(userId, googleSub);
  const receiptData = {
    purchaseIntentId: purchaseIntent.id,
    merchantOrderId: purchaseIntent.merchant_order_id,
    productName: product.name,
    priceXlm: amount,
    currency: 'XLM',
    merchant: site.merchant_stellar_address,
    timestamp: new Date().toISOString(),
  };
  const memoHash = buildReceiptMemo(receiptData);
  const intentHash = createHash('sha256').update(purchaseIntent.id).digest('hex');
  await markIntentState(purchaseIntent.id, 'payment_submitted');
  let submitted;
  try {
    submitted = await submitGuardedSpend({
      ownerPublicKey: ownerWallet.public_key,
      agentKeypair,
      merchant: site.merchant_stellar_address,
      domainHashHex: site.merchant_domain_hash,
      amountXlm: amount,
      intentHashHex: intentHash,
      receiptHash: memoHash,
    });
  } catch (error) {
    error.indeterminate = /timeout|network|fetch/i.test(error.message);
    throw error;
  }
  const [purchase] = await getDb()`
    insert into purchases (user_id, site_id, purchase_intent_id, product_name, product_url, product_image, price_xlm, stellar_tx_hash, receipt_memo_hash, status)
    values (${userId}, ${site.id}, ${purchaseIntent.id}, ${product.name}, ${product.url || null}, ${product.image || null}, ${amount}, ${submitted.txHash}, ${memoHash.toString('hex')}, 'pending') returning *`;
  await markIntentState(purchaseIntent.id, 'payment_confirmed', { policy_tx_hash: submitted.txHash });
  const explorerNetwork = config.stellarNetwork === 'mainnet' ? 'public' : 'testnet';
  return { success: true, purchaseId: purchase.id, txHash: submitted.txHash, priceXlm: amount, explorerUrl: `https://stellar.expert/explorer/${explorerNetwork}/tx/${submitted.txHash}`, receiptData, memoHash: memoHash.toString('hex') };
}

export async function getPurchaseHistory(userId) {
  return getDb()`select p.*, cs.site_name from purchases p left join connected_sites cs on p.site_id = cs.id where p.user_id = ${userId} order by p.created_at desc`;
}
