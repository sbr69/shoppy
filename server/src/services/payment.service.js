import * as StellarSdk from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { getKeypairForSigning } from './wallet.service.js';
import { buildReceiptMemo } from './receipt.service.js';
import { markIntentState } from './policy.service.js';

const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);

export async function executePayment(userId, googleSub, purchaseIntent, site, product) {
  const amount = Number(purchaseIntent.price_xlm);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid verified payment amount');
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(site.merchant_stellar_address)) throw new Error('Registered merchant address is invalid');
  const keypair = getKeypairForSigning(userId, googleSub);
  let account;
  try { account = await horizon.loadAccount(keypair.publicKey()); }
  catch (error) { throw new Error(error?.response?.status === 404 ? 'Wallet is not funded on Stellar testnet.' : 'Unable to load Stellar wallet.'); }
  const native = Number(account.balances.find((balance) => balance.asset_type === 'native')?.balance || 0);
  if (native < amount + 0.01) throw new Error('Insufficient XLM balance for this payment and network fee');

  const receiptData = {
    purchaseIntentId: purchaseIntent.id,
    merchantOrderId: purchaseIntent.merchant_order_id,
    productName: product.name,
    priceXlm: amount,
    currency: 'XLM',
    merchant: site.merchant_stellar_address,
    timestamp: new Date().toISOString(),
  };
  const transaction = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: StellarSdk.Networks.TESTNET })
    .addOperation(StellarSdk.Operation.payment({ destination: site.merchant_stellar_address, asset: StellarSdk.Asset.native(), amount: amount.toFixed(7) }))
    .addMemo(StellarSdk.Memo.hash(buildReceiptMemo(receiptData)))
    .setTimeout(30)
    .build();
  transaction.sign(keypair);
  markIntentState(purchaseIntent.id, 'payment_submitted');
  let submitted;
  try { submitted = await horizon.submitTransaction(transaction); }
  catch (error) {
    const code = error?.response?.data?.extras?.result_codes;
    const paymentError = new Error(`Stellar transaction failed: ${code ? JSON.stringify(code) : error.message}`);
    // A network timeout can occur after Horizon accepted the transaction. Do
    // not allow a retry that could pay a merchant twice in this case.
    paymentError.indeterminate = !code;
    throw paymentError;
  }
  const purchaseId = uuidv4();
  getDb().prepare(
    `INSERT INTO purchases (id, user_id, site_id, product_name, product_url, product_image, price_xlm, stellar_tx_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(purchaseId, userId, site.id, product.name, product.url || null, product.image || null, amount, submitted.hash);
  markIntentState(purchaseIntent.id, 'payment_confirmed');
  return { success: true, purchaseId, txHash: submitted.hash, priceXlm: amount, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${submitted.hash}`, receiptData, memoHash: buildReceiptMemo(receiptData).toString('hex') };
}

export function getPurchaseHistory(userId) {
  return getDb().prepare(`SELECT p.*, cs.site_name FROM purchases p LEFT JOIN connected_sites cs ON p.site_id = cs.id WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(userId);
}
