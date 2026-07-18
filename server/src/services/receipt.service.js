import { createHash } from 'crypto';

/**
 * Build a SHA-256 hash of purchase receipt data.
 *
 * Guarded payments are Soroban invocations, which cannot use Stellar memos.
 * This hash is instead supplied to SpendGuard and emitted in its `purchased`
 * contract event as the immutable on-chain receipt attestation.
 *
 * The legacy function name is retained so existing receipt verification code
 * continues to work while the receipt transport is contract-event based.
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
 * Verify that receipt data matches the hash attested by SpendGuard.
 */
export function verifyReceiptMemo(receiptData, memoHashHex) {
  const computed = buildReceiptMemo(receiptData);
  return computed.toString('hex') === memoHashHex;
}
