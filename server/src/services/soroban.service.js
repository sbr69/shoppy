import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config/env.js';

const OWNER_ACTION_TIMEOUT_SECONDS = 120;
const APPROVAL_LEDGER_TTL = 20;

function requireContracts() {
  if (!config.spendGuardContractId || !config.trustListContractId || !config.settlementTokenContractId) {
    throw new Error('Soroban contracts are not configured');
  }
}

function rpc() {
  return new StellarSdk.rpc.Server(config.sorobanRpcUrl);
}

function contractArgAddress(value) {
  return StellarSdk.nativeToScVal(StellarSdk.Address.fromString(value));
}

function bytes32(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Expected a 32-byte hexadecimal hash');
  return StellarSdk.nativeToScVal(new Uint8Array(Buffer.from(hex, 'hex')), { type: 'bytes' });
}

export function xlmToStroops(amount) {
  const value = String(amount);
  if (!/^\d+(?:\.\d{1,7})?$/.test(value) || Number(value) <= 0) throw new Error('Invalid XLM amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(`${fraction}0000000`.slice(0, 7));
}

async function prepareInvocation({ sourcePublicKey, contractId, method, args, memoHash, timeoutSeconds = OWNER_ACTION_TIMEOUT_SECONDS }) {
  const server = rpc();
  const account = await server.getAccount(sourcePublicKey);
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.stellarNetworkPassphrase,
  }).addOperation(new StellarSdk.Contract(contractId).call(method, ...args));
  if (memoHash) builder.addMemo(StellarSdk.Memo.hash(memoHash));
  const unsigned = builder.setTimeout(timeoutSeconds).build();
  return server.prepareTransaction(unsigned);
}

async function awaitSubmittedTransaction(server, sent) {
  const result = await server.pollTransaction(sent.hash, { attempts: 8 });
  if (result?.status === 'FAILED') throw new Error('Soroban transaction failed during finalization');
  return { final: result?.status === 'SUCCESS', finalStatus: result?.status || 'NOT_FOUND' };
}

function requireSingleSourceSignature(transaction, expectedTransaction, ownerPublicKey) {
  if (!Buffer.from(transaction.signatureBase()).equals(Buffer.from(expectedTransaction.signatureBase()))) {
    throw new Error('The signed transaction does not match the prepared action');
  }
  if (transaction.source !== ownerPublicKey || expectedTransaction.source !== ownerPublicKey) {
    throw new Error('The signed transaction has the wrong source account');
  }
  const owner = StellarSdk.Keypair.fromPublicKey(ownerPublicKey);
  const transactionHash = transaction.hash();
  const validSignature = transaction.signatures.some((signature) => owner.verify(transactionHash, signature.signature()));
  if (!validSignature) throw new Error('The prepared action is missing the owner signature');
}

function addressCredentials(entry) {
  const credentials = entry.credentials();
  const credentialType = credentials.switch().name;
  if (credentialType !== 'sorobanCredentialsAddress' && credentialType !== 'sorobanCredentialsAddressV2') return null;
  return credentials.address();
}

function authEntryOwner(entry) {
  const credentials = addressCredentials(entry);
  if (!credentials) return null;
  return StellarSdk.Address.fromScAddress(credentials.address()).toString();
}

function authEntryMatchesPrepared(expected, supplied, ownerPublicKey, validUntilLedgerSeq) {
  const expectedCredentials = addressCredentials(expected);
  const suppliedCredentials = addressCredentials(supplied);
  if (!expectedCredentials || !suppliedCredentials) return false;
  if (authEntryOwner(expected) !== ownerPublicKey || authEntryOwner(supplied) !== ownerPublicKey) return false;
  if (expected.credentials().switch().name !== supplied.credentials().switch().name) return false;
  if (expectedCredentials.nonce().toString() !== suppliedCredentials.nonce().toString()) return false;
  if (Number(suppliedCredentials.signatureExpirationLedger()) !== Number(validUntilLedgerSeq)) return false;
  return Buffer.from(expected.rootInvocation().toXDR()).equals(Buffer.from(supplied.rootInvocation().toXDR()));
}

function ownerAuthIndex(transaction, ownerPublicKey) {
  if (transaction.operations.length !== 1) throw new Error('Prepared payment has an unexpected operation count');
  const entries = transaction.operations[0].auth || [];
  const index = entries.findIndex((entry) => authEntryOwner(entry) === ownerPublicKey);
  if (index < 0) throw new Error('Prepared payment did not request owner authorization');
  return index;
}

export async function prepareOwnerAction({ actionType, ownerPublicKey, agentPublicKey, site, amountXlm }) {
  requireContracts();
  let contractId;
  let method;
  let args;
  if (actionType === 'set_agent') {
    contractId = config.spendGuardContractId;
    method = 'set_agent';
    args = [contractArgAddress(ownerPublicKey), contractArgAddress(agentPublicKey)];
  } else if (actionType === 'set_trust_rule') {
    if (!site) throw new Error('A store is required to set a trust rule');
    contractId = config.trustListContractId;
    method = 'set_rule';
    args = [
      contractArgAddress(ownerPublicKey),
      bytes32(site.merchant_domain_hash),
      contractArgAddress(site.merchant_stellar_address),
      StellarSdk.nativeToScVal(xlmToStroops(site.spending_cap), { type: 'i128' }),
      StellarSdk.nativeToScVal(xlmToStroops(site.per_transaction_cap), { type: 'i128' }),
      StellarSdk.nativeToScVal(site.category || 'general', { type: 'symbol' }),
      StellarSdk.nativeToScVal(true),
      StellarSdk.nativeToScVal(BigInt(site.trust_rule_version), { type: 'u32' }),
    ];
  } else if (actionType === 'deposit') {
    contractId = config.spendGuardContractId;
    method = 'deposit';
    args = [contractArgAddress(ownerPublicKey), StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: 'i128' })];
  } else {
    throw new Error('Unsupported owner action');
  }
  const prepared = await prepareInvocation({ sourcePublicKey: ownerPublicKey, contractId, method, args });
  return {
    transactionXdr: prepared.toXDR(),
    expiresAt: new Date(Date.now() + OWNER_ACTION_TIMEOUT_SECONDS * 1000).toISOString(),
    summary: { actionType, contractId, method, ownerPublicKey, agentPublicKey: agentPublicKey || null, amountXlm: amountXlm || null, siteId: site?.id || null },
  };
}

export async function submitOwnerAction({ signedTransactionXdr, preparedTransactionXdr, ownerPublicKey }) {
  const signed = new StellarSdk.Transaction(signedTransactionXdr, config.stellarNetworkPassphrase);
  const prepared = new StellarSdk.Transaction(preparedTransactionXdr, config.stellarNetworkPassphrase);
  requireSingleSourceSignature(signed, prepared, ownerPublicKey);
  const server = rpc();
  const sent = await server.sendTransaction(signed);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    throw new Error(`Owner action was not accepted: ${sent.status}`);
  }
  return { txHash: sent.hash, rpcStatus: sent.status, ...(await awaitSubmittedTransaction(server, sent)) };
}

/** Execute a narrowly defined owner contract action with the server-held custodial key. */
export async function submitCustodialOwnerAction({ actionType, ownerKeypair, ownerPublicKey, agentPublicKey, site, amountXlm }) {
  const prepared = await prepareOwnerAction({ actionType, ownerPublicKey, agentPublicKey, site, amountXlm });
  const transaction = new StellarSdk.Transaction(prepared.transactionXdr, config.stellarNetworkPassphrase);
  transaction.sign(ownerKeypair);
  const server = rpc();
  const sent = await server.sendTransaction(transaction);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') throw new Error(`Custodial owner action was not accepted: ${sent.status}`);
  return { txHash: sent.hash, rpcStatus: sent.status, ...(await awaitSubmittedTransaction(server, sent)) };
}

export async function getSorobanTransactionStatus(txHash) {
  const result = await rpc().getTransaction(txHash);
  return result?.status || 'NOT_FOUND';
}

/**
 * Build a SpendGuard spend using the backend agent as transaction source. The
 * returned authorization entry is intentionally unsigned and is the only
 * payload the browser may sign with its owner key.
 */
export async function prepareGuardedSpend({ ownerPublicKey, agentPublicKey, merchant, domainHashHex, amountXlm, intentHashHex, receiptHash }) {
  requireContracts();
  const server = rpc();
  const latestLedger = await server.getLatestLedger();
  const validUntilLedgerSeq = latestLedger.sequence + APPROVAL_LEDGER_TTL;
  const prepared = await prepareInvocation({
    sourcePublicKey: agentPublicKey,
    contractId: config.spendGuardContractId,
    method: 'spend',
    args: [
      contractArgAddress(ownerPublicKey),
      contractArgAddress(agentPublicKey),
      bytes32(domainHashHex),
      contractArgAddress(merchant),
      StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: 'i128' }),
      bytes32(intentHashHex),
      StellarSdk.nativeToScVal(new Uint8Array(receiptHash), { type: 'bytes' }),
    ],
    memoHash: receiptHash,
  });
  const ownerIndex = ownerAuthIndex(prepared, ownerPublicKey);
  const authorizationEntry = prepared.operations[0].auth[ownerIndex];
  return {
    transactionXdr: prepared.toXDR(),
    authorizationEntryXdr: authorizationEntry.toXDR('base64'),
    validUntilLedgerSeq,
    expiresAt: new Date(Date.now() + OWNER_ACTION_TIMEOUT_SECONDS * 1000).toISOString(),
  };
}

/** Attach only a matching owner authorization entry, then sign and submit as the agent. */
export async function submitGuardedSpend({ preparedTransactionXdr, expectedAuthorizationEntryXdr, signedAuthorizationEntryXdr, ownerPublicKey, agentKeypair, validUntilLedgerSeq }) {
  const transaction = new StellarSdk.Transaction(preparedTransactionXdr, config.stellarNetworkPassphrase);
  if (transaction.source !== agentKeypair.publicKey()) throw new Error('Prepared payment source does not match the constrained agent signer');
  const expected = StellarSdk.xdr.SorobanAuthorizationEntry.fromXDR(expectedAuthorizationEntryXdr, 'base64');
  const supplied = StellarSdk.xdr.SorobanAuthorizationEntry.fromXDR(signedAuthorizationEntryXdr, 'base64');
  if (!authEntryMatchesPrepared(expected, supplied, ownerPublicKey, validUntilLedgerSeq)) {
    throw new Error('Owner authorization does not match the exact prepared purchase');
  }
  const index = ownerAuthIndex(transaction, ownerPublicKey);
  transaction.operations[0].auth[index] = supplied;
  transaction.sign(agentKeypair);
  const server = rpc();
  const sent = await server.sendTransaction(transaction);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    throw new Error(`SpendGuard payment was not accepted: ${sent.status}`);
  }
  return { txHash: sent.hash, rpcStatus: sent.status, ...(await awaitSubmittedTransaction(server, sent)) };
}

/** Custodial owner authorization, invoked only after application confirmation. */
export async function submitCustodialGuardedSpend({ ownerKeypair, ownerPublicKey, agentKeypair, merchant, domainHashHex, amountXlm, intentHashHex, receiptHash }) {
  const prepared = await prepareGuardedSpend({ ownerPublicKey, agentPublicKey: agentKeypair.publicKey(), merchant, domainHashHex, amountXlm, intentHashHex, receiptHash });
  const entry = StellarSdk.xdr.SorobanAuthorizationEntry.fromXDR(prepared.authorizationEntryXdr, 'base64');
  const signed = await StellarSdk.authorizeEntry(entry, ownerKeypair, prepared.validUntilLedgerSeq, config.stellarNetworkPassphrase);
  return submitGuardedSpend({ preparedTransactionXdr: prepared.transactionXdr, expectedAuthorizationEntryXdr: prepared.authorizationEntryXdr, signedAuthorizationEntryXdr: signed.toXDR('base64'), ownerPublicKey, agentKeypair, validUntilLedgerSeq: prepared.validUntilLedgerSeq });
}
