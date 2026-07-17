import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config/env.js';

function requireContracts() {
  if (!config.spendGuardContractId || !config.trustListContractId || !config.settlementTokenContractId) {
    throw new Error('Soroban contracts are not configured');
  }
}

export function xlmToStroops(amount) {
  const value = String(amount);
  if (!/^\d+(?:\.\d{1,7})?$/.test(value) || Number(value) <= 0) throw new Error('Invalid XLM amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(`${fraction}0000000`.slice(0, 7));
}

async function submitInvocation(keypair, contractId, method, args, memoHash) {
  const rpc = new StellarSdk.rpc.Server(config.sorobanRpcUrl);
  const account = await rpc.getAccount(keypair.publicKey());
  const builder = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: config.stellarNetworkPassphrase })
    .addOperation(new StellarSdk.Contract(contractId).call(method, ...args));
  if (memoHash) builder.addMemo(StellarSdk.Memo.hash(memoHash));
  const prepared = await rpc.prepareTransaction(builder.setTimeout(60).build());
  prepared.sign(keypair);
  const sent = await rpc.sendTransaction(prepared);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') throw new Error(`${method} was not accepted: ${sent.status}`);
  return sent.hash;
}

export async function configureGuardedSite({ ownerKeypair, agentPublicKey, ownerPublicKey, site }) {
  requireContracts();
  const agentTxHash = await submitInvocation(ownerKeypair, config.spendGuardContractId, 'set_agent', [
    StellarSdk.nativeToScVal(StellarSdk.Address.fromString(ownerPublicKey)),
    StellarSdk.nativeToScVal(StellarSdk.Address.fromString(agentPublicKey)),
  ]);
  const ruleTxHash = await submitInvocation(ownerKeypair, config.trustListContractId, 'set_rule', [
    StellarSdk.nativeToScVal(StellarSdk.Address.fromString(ownerPublicKey)),
    StellarSdk.nativeToScVal(new Uint8Array(Buffer.from(site.merchant_domain_hash, 'hex')), { type: 'bytes' }),
    StellarSdk.nativeToScVal(StellarSdk.Address.fromString(site.merchant_stellar_address)),
    StellarSdk.nativeToScVal(xlmToStroops(site.spending_cap), { type: 'i128' }),
    StellarSdk.nativeToScVal(xlmToStroops(site.per_transaction_cap), { type: 'i128' }),
    StellarSdk.nativeToScVal(site.category || 'general', { type: 'symbol' }),
    StellarSdk.nativeToScVal(true),
    StellarSdk.nativeToScVal(BigInt(site.trust_rule_version), { type: 'u32' }),
  ]);
  return { agentTxHash, ruleTxHash };
}

export async function depositEscrow({ ownerKeypair, ownerPublicKey, amountXlm }) {
  requireContracts();
  return submitInvocation(ownerKeypair, config.spendGuardContractId, 'deposit', [
    StellarSdk.nativeToScVal(StellarSdk.Address.fromString(ownerPublicKey)),
    StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: 'i128' }),
  ]);
}

/**
 * Calls SpendGuard.spend. The transaction source is the per-user agent key,
 * satisfying agent.require_auth(); no owner key can be used for unattended
 * payments. The receipt hash is both a Memo.hash and a contract event field.
 */
export async function submitGuardedSpend({ ownerPublicKey, agentKeypair, merchant, domainHashHex, amountXlm, intentHashHex, receiptHash }) {
  requireContracts();
  const txHash = await submitInvocation(agentKeypair, config.spendGuardContractId, 'spend', [
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(ownerPublicKey)),
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(agentKeypair.publicKey())),
      StellarSdk.nativeToScVal(new Uint8Array(Buffer.from(domainHashHex, 'hex')), { type: 'bytes' }),
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(merchant)),
      StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: 'i128' }),
      StellarSdk.nativeToScVal(new Uint8Array(Buffer.from(intentHashHex, 'hex')), { type: 'bytes' }),
      StellarSdk.nativeToScVal(new Uint8Array(receiptHash), { type: 'bytes' }),
  ], receiptHash);
  return { txHash, rpcStatus: 'PENDING' };
}
