import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config/env.js';

const OWNER_ACTION_TIMEOUT_SECONDS = 120;
const APPROVAL_LEDGER_TTL = 20;

function requireContracts() {
  if (!config.spendGuardContractId || !config.trustListContractId || !config.settlementTokenContractId) {
    throw new Error('Soroban contracts are not configured');
  }
}

function requireAgentWalletContracts() {
  if (!config.agentWalletWasmHash || !config.trustListContractId || !config.settlementTokenContractId) {
    throw new Error('Agent Smart Wallet contracts are not configured');
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

async function prepareInvocation({ sourcePublicKey, contractId, method, args, timeoutSeconds = OWNER_ACTION_TIMEOUT_SECONDS }) {
  const server = rpc();
  const account = await server.getAccount(sourcePublicKey);
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.stellarNetworkPassphrase,
  }).addOperation(new StellarSdk.Contract(contractId).call(method, ...args));
  const unsigned = builder.setTimeout(timeoutSeconds).build();
  return server.prepareTransaction(unsigned);
}

async function awaitSubmittedTransaction(server, sent) {
  const result = await server.pollTransaction(sent.hash, { attempts: 8 });
  if (result?.status === 'FAILED') {
    const diagnostic = result?.diagnosticEvents?.map((event) => event.toXDR('base64')).join(',') || result?.errorResultXdr || 'no diagnostic details returned';
    throw new Error(`Soroban transaction failed during finalization: ${diagnostic}`);
  }
  return { final: result?.status === 'SUCCESS', finalStatus: result?.status || 'NOT_FOUND' };
}

function contractSigner(keypair) {
  return StellarSdk.contract.basicNodeSigner(keypair, config.stellarNetworkPassphrase);
}

/** Deploy and initialize one immutable C... Agent Smart Wallet for a user. */
export async function deployAgentSmartWallet({ ownerKeypair, ownerPublicKey, agentPublicKey }) {
  requireAgentWalletContracts();
  const deployment = await StellarSdk.contract.Client.deploy(
    {
      owner: ownerPublicKey,
      agent: agentPublicKey,
      token: config.settlementTokenContractId,
      trust_list: config.trustListContractId,
    },
    {
      wasmHash: config.agentWalletWasmHash,
      format: 'hex',
      publicKey: ownerPublicKey,
      rpcUrl: config.sorobanRpcUrl,
      networkPassphrase: config.stellarNetworkPassphrase,
      timeoutInSeconds: OWNER_ACTION_TIMEOUT_SECONDS,
      ...contractSigner(ownerKeypair),
    },
  );
  const sent = await deployment.signAndSend();
  const client = sent.result;
  return {
    contractId: client.options.contractId,
    txHash: sent.sendTransactionResponse.hash,
    final: sent.getTransactionResponse?.status === 'SUCCESS',
    finalStatus: sent.getTransactionResponse?.status || 'NOT_FOUND',
  };
}

async function submitAgentWalletInvocation({ sourceKeypair, sourcePublicKey, contractId, method, args }) {
  const prepared = await prepareInvocation({ sourcePublicKey, contractId, method, args });
  const transaction = new StellarSdk.Transaction(prepared.toXDR(), config.stellarNetworkPassphrase);
  transaction.sign(sourceKeypair);
  const server = rpc();
  const sent = await server.sendTransaction(transaction);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    throw new Error(`Agent Smart Wallet action was not accepted: ${sent.status}`);
  }
  return { txHash: sent.hash, rpcStatus: sent.status, ...(await awaitSubmittedTransaction(server, sent)) };
}

/** Fund the smart-wallet balance once from the custodial funding account. */
export async function fundAgentSmartWallet({ smartWalletId, ownerKeypair, ownerPublicKey, amountXlm }) {
  requireAgentWalletContracts();
  return submitAgentWalletInvocation({
    sourceKeypair: ownerKeypair,
    sourcePublicKey: ownerPublicKey,
    contractId: smartWalletId,
    method: 'fund',
    args: [contractArgAddress(ownerPublicKey), StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: 'i128' })],
  });
}

/** Recover or migrate unused funds from a smart wallet under owner authorization. */
export async function withdrawAgentSmartWallet({ smartWalletId, ownerKeypair, ownerPublicKey, recipient, amountXlm }) {
  requireAgentWalletContracts();
  return submitAgentWalletInvocation({
    sourceKeypair: ownerKeypair,
    sourcePublicKey: ownerPublicKey,
    contractId: smartWalletId,
    method: 'withdraw',
    args: [
      contractArgAddress(ownerPublicKey),
      contractArgAddress(recipient),
      StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: 'i128' }),
    ],
  });
}

/** Spend directly from the C... smart-wallet balance after its policy check. */
export async function submitAgentSmartWalletSpend({ smartWalletId, ownerKeypair, ownerPublicKey, agentKeypair, merchant, domainHashHex, amountXlm, intentHashHex, receiptHash }) {
  requireAgentWalletContracts();
  const server = rpc();
  const latestLedger = await server.getLatestLedger();
  const prepared = await prepareInvocation({
    sourcePublicKey: agentKeypair.publicKey(),
    contractId: smartWalletId,
    method: 'spend',
    args: [
      contractArgAddress(agentKeypair.publicKey()),
      bytes32(domainHashHex),
      contractArgAddress(merchant),
      StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: 'i128' }),
      bytes32(intentHashHex),
      StellarSdk.nativeToScVal(new Uint8Array(receiptHash), { type: 'bytes' }),
    ],
  });
  const transaction = new StellarSdk.Transaction(prepared.toXDR(), config.stellarNetworkPassphrase);
  const ownerAuthorizationIndex = ownerAuthIndex(transaction, ownerPublicKey);
  const ownerAuthorization = transaction.operations[0].auth[ownerAuthorizationIndex];
  transaction.operations[0].auth[ownerAuthorizationIndex] = await StellarSdk.authorizeEntry(
    ownerAuthorization,
    ownerKeypair,
    latestLedger.sequence + APPROVAL_LEDGER_TTL,
    config.stellarNetworkPassphrase,
  );
  transaction.sign(agentKeypair);
  const sent = await server.sendTransaction(transaction);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    throw new Error(`Agent Smart Wallet spend was not accepted: ${sent.status}`);
  }
  return { txHash: sent.hash, rpcStatus: sent.status, ...(await awaitSubmittedTransaction(server, sent)) };
}

/** Read an on-chain smart-wallet balance without signing or changing state. */
export async function getAgentSmartWalletBalance({ smartWalletId, sourcePublicKey }) {
  const server = rpc();
  const account = await server.getAccount(sourcePublicKey);
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.stellarNetworkPassphrase,
  }).addOperation(new StellarSdk.Contract(smartWalletId).call('balance')).setTimeout(30).build();
  const simulated = await server.simulateTransaction(transaction);
  if (!simulated.result?.retval) throw new Error('Unable to read Agent Smart Wallet balance');
  return StellarSdk.scValToNative(simulated.result.retval);
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
  if (credentialType === 'sorobanCredentialsAddress') return credentials.address();
  // Stellar protocol upgrades use a distinct union arm for AddressV2. Calling
  // `address()` on that arm returns an invalid value, so select it explicitly.
  if (credentialType === 'sorobanCredentialsAddressV2') return credentials.addressV2();
  return null;
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
  } else if (actionType === 'remove_trust_rule') {
    if (!site) throw new Error('A store is required to remove a trust rule');
    contractId = config.trustListContractId;
    method = 'remove_rule';
    args = [
      contractArgAddress(ownerPublicKey),
      bytes32(site.merchant_domain_hash),
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
