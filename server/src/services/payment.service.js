import * as StellarSdk from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { getKeypairForSigning, getWalletByUserId } from './wallet.service.js';
import { buildReceiptMemo } from './receipt.service.js';

const HORIZON_SERVER = new StellarSdk.Horizon.Server(config.horizonUrl);

/**
 * Execute a Stellar payment for a purchase.
 *
 * Flow:
 * 1. Validate spending cap
 * 2. Decrypt the user's key in memory
 * 3. Build a payment transaction (user → merchant)
 * 4. Attach a receipt memo (SHA-256 hash of purchase metadata)
 * 5. Sign + submit to Stellar testnet
 * 6. Record the purchase in DB
 * 7. Clear the decrypted key from memory
 */
export async function executePayment(userId, googleSub, product, siteId) {
  const db = getDb();

  // Convert INR price to XLM (fixed demo rate: 1 XLM = 10 INR)
  const XLM_RATE = 10;
  const priceXlm = parseFloat((product.price / XLM_RATE).toFixed(7));

  if (priceXlm <= 0) {
    throw new Error('Invalid payment amount');
  }

  // Check spending cap
  if (siteId) {
    const site = db.prepare('SELECT spending_cap FROM connected_sites WHERE id = ?').get(siteId);
    if (site && priceXlm > site.spending_cap) {
      throw new Error(`Purchase exceeds your spending cap of ${site.spending_cap} XLM for this site`);
    }
  }

  // Get the user's wallet
  const wallet = getWalletByUserId(userId);
  if (!wallet) {
    throw new Error('No wallet found. Please fund your wallet first.');
  }

  // Decrypt signing key (lives only in this scope)
  let keypair;
  try {
    keypair = getKeypairForSigning(userId, googleSub);
  } catch (err) {
    throw new Error('Failed to access wallet signing key');
  }

  // Load the account from Stellar
  let account;
  try {
    account = await HORIZON_SERVER.loadAccount(keypair.publicKey());
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error('Wallet not funded on Stellar testnet. Click "Fund Wallet" first.');
    }
    throw new Error('Failed to load Stellar account');
  }

  // Check balance
  const nativeBalance = account.balances.find(b => b.asset_type === 'native');
  const availableBalance = parseFloat(nativeBalance?.balance || '0');
  if (availableBalance < priceXlm + 1) {
    throw new Error(`Insufficient balance. You have ${availableBalance} XLM but need ${priceXlm} XLM + fees.`);
  }

  // Build the receipt memo
  const receiptData = {
    productName: product.name,
    price: product.price,
    currency: product.currency || 'INR',
    priceXlm,
    merchant: config.merchantStellarAddress,
    timestamp: new Date().toISOString(),
  };
  const memoHash = buildReceiptMemo(receiptData);

  // Build the transaction
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: config.merchantStellarAddress,
        asset: StellarSdk.Asset.native(),
        amount: priceXlm.toString(),
      })
    )
    .addMemo(StellarSdk.Memo.hash(memoHash))
    .setTimeout(30)
    .build();

  // Sign
  transaction.sign(keypair);

  // Submit
  let txResult;
  try {
    txResult = await HORIZON_SERVER.submitTransaction(transaction);
  } catch (err) {
    const extras = err?.response?.data?.extras?.result_codes;
    const detail = extras ? JSON.stringify(extras) : err.message;
    throw new Error(`Stellar transaction failed: ${detail}`);
  }

  // Record in DB
  const purchaseId = uuidv4();
  db.prepare(
    `INSERT INTO purchases (id, user_id, site_id, product_name, product_url, product_image, price_xlm, stellar_tx_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    purchaseId,
    userId,
    siteId || null,
    product.name,
    product.url || null,
    product.image || null,
    priceXlm,
    txResult.hash,
    'confirmed'
  );

  return {
    success: true,
    purchaseId,
    txHash: txResult.hash,
    priceXlm,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txResult.hash}`,
    receiptData,
  };
}

/**
 * Get purchase history for a user.
 */
export function getPurchaseHistory(userId) {
  const db = getDb();
  return db.prepare(
    `SELECT p.*, cs.site_name
     FROM purchases p
     LEFT JOIN connected_sites cs ON p.site_id = cs.id
     WHERE p.user_id = ?
     ORDER BY p.created_at DESC`
  ).all(userId);
}
