import { createHash } from 'crypto';

/**
 * Build a SHA-256 hash of purchase receipt data for use as a Stellar Memo.hash.
 *
 * The memo serves as an immutable on-chain attestation of the purchase.
 * Anyone with the original receipt data can verify it matches the on-chain hash.
 *
 * Returns a 32-byte Buffer suitable for Stellar Memo.hash().
 */
export function buildReceiptMemo(receiptData) {
  const payload = JSON.stringify({
    i: receiptData.purchaseIntentId,
    o: receiptData.merchantOrderId,
    p: receiptData.productName,
    a: receiptData.priceXlm,
    c: receiptData.currency,
    m: receiptData.merchant,
    t: receiptData.timestamp,
  });

  return createHash('sha256').update(payload).digest();
}

/**
 * Verify that a receipt data object matches a given memo hash.
 * Used by the frontend or any auditor to validate on-chain receipts.
 */
export function verifyReceiptMemo(receiptData, memoHashHex) {
  const computed = buildReceiptMemo(receiptData);
  return computed.toString('hex') === memoHashHex;
}
