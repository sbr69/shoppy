import * as StellarSdk from '@stellar/stellar-sdk';
import api from './api';

const VAULT_AAD_PREFIX = 'jarvispayz-passkey-vault:v1:';

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function creationOptionsFromJSON(options) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    user: { ...options.user, id: base64UrlToBytes(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map((credential) => ({ ...credential, id: base64UrlToBytes(credential.id) })),
    extensions: options.extensions?.prf?.eval
      ? { ...options.extensions, prf: { ...options.extensions.prf, eval: { ...options.extensions.prf.eval, first: base64UrlToBytes(options.extensions.prf.eval.first), second: options.extensions.prf.eval.second ? base64UrlToBytes(options.extensions.prf.eval.second) : undefined } } }
      : options.extensions,
  };
}

function requestOptionsFromJSON(options) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({ ...credential, id: base64UrlToBytes(credential.id) })),
    extensions: options.extensions?.prf?.eval
      ? { ...options.extensions, prf: { ...options.extensions.prf, eval: { ...options.extensions.prf.eval, first: base64UrlToBytes(options.extensions.prf.eval.first), second: options.extensions.prf.eval.second ? base64UrlToBytes(options.extensions.prf.eval.second) : undefined } } }
      : options.extensions,
  };
}

function credentialToJSON(credential) {
  const response = credential.response;
  const base = {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
  };
  if ('attestationObject' in response) {
    return {
      ...base,
      response: {
        clientDataJSON: bytesToBase64Url(response.clientDataJSON),
        attestationObject: bytesToBase64Url(response.attestationObject),
        transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
      },
    };
  }
  return {
    ...base,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : undefined,
    },
  };
}

function requirePasskeyPrf(credential) {
  const first = credential.getClientExtensionResults?.()?.prf?.results?.first;
  if (!(first instanceof ArrayBuffer) || first.byteLength < 32) {
    throw new Error('This passkey or browser does not support the required PRF extension. Use a synced Chrome, Edge, or compatible platform passkey.');
  }
  return new Uint8Array(first);
}

async function deriveVaultKey(prfBytes, vaultSalt) {
  const material = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: base64UrlToBytes(vaultSalt), info: new TextEncoder().encode('jarvispayz-passkey-vault-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptOwnerSecret(keypair, prfBytes, vaultSalt) {
  const key = await deriveVaultKey(prfBytes, vaultSalt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(keypair.secret());
  const aad = new TextEncoder().encode(`${VAULT_AAD_PREFIX}${keypair.publicKey()}`);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
  return { publicKey: keypair.publicKey(), ciphertext: bytesToBase64Url(ciphertext), iv: bytesToBase64Url(iv) };
}

async function decryptOwnerSecret(vault, prfBytes) {
  const key = await deriveVaultKey(prfBytes, vault.salt);
  const aad = new TextEncoder().encode(`${VAULT_AAD_PREFIX}${vault.publicKey}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(vault.iv), additionalData: aad },
    key,
    base64UrlToBytes(vault.ciphertext),
  );
  const keypair = StellarSdk.Keypair.fromSecret(new TextDecoder().decode(plaintext));
  if (keypair.publicKey() !== vault.publicKey) throw new Error('The unlocked vault does not match this wallet');
  return keypair;
}

function ensureWebAuthn() {
  if (!window.PublicKeyCredential || !navigator.credentials || !window.isSecureContext) {
    throw new Error('A secure browser context with WebAuthn support is required for the passkey vault');
  }
}

function openVaultStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('jarvispayz-passkey-vault', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vaults', { keyPath: 'publicKey' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cacheVault(vault) {
  if (!vault?.publicKey) return;
  const db = await openVaultStore();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('vaults', 'readwrite');
    transaction.objectStore('vaults').put(vault);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

/** Register a synced passkey, then generate and browser-encrypt the Stellar owner key. */
export async function setupPasskeyVault() {
  ensureWebAuthn();
  const { data: registration } = await api.post('/wallet/vault/registration/options');
  const credential = await navigator.credentials.create({ publicKey: creationOptionsFromJSON(registration.options) });
  if (!credential) throw new Error('Passkey registration was cancelled');
  await api.post('/wallet/vault/registration/verify', { credential: credentialToJSON(credential) });

  const { vault, prfBytes } = await unlockPasskeyVault();
  if (vault) throw new Error('A passkey vault already exists for this account');
  const owner = StellarSdk.Keypair.random();
  const encrypted = await encryptOwnerSecret(owner, prfBytes, registration.vaultSalt);
  const { data } = await api.post('/wallet/vault/provision', {
    ...encrypted,
    credentialId: credential.id,
  });
  await cacheVault({ ...encrypted, salt: registration.vaultSalt, credentialId: credential.id });
  return data.wallet;
}

/** Passkey user verification returns a key only in memory for the immediate action. */
export async function unlockPasskeyVault() {
  ensureWebAuthn();
  const { data: request } = await api.post('/wallet/vault/unlock/options');
  const credential = await navigator.credentials.get({ publicKey: requestOptionsFromJSON(request.options) });
  if (!credential) throw new Error('Passkey unlock was cancelled');
  const prfBytes = requirePasskeyPrf(credential);
  const { data } = await api.post('/wallet/vault/unlock/verify', { credential: credentialToJSON(credential) });
  if (data.vault) await cacheVault(data.vault);
  return { vault: data.vault, prfBytes };
}

async function unlockedOwnerKeypair() {
  const { vault, prfBytes } = await unlockPasskeyVault();
  if (!vault) throw new Error('Your vault has not been provisioned yet');
  return decryptOwnerSecret(vault, prfBytes);
}

export async function signPurchaseAuthorization(approval, networkPassphrase) {
  const owner = await unlockedOwnerKeypair();
  const entry = StellarSdk.xdr.SorobanAuthorizationEntry.fromXDR(approval.authorizationEntryXdr, 'base64');
  const signed = await StellarSdk.authorizeEntry(entry, owner, approval.validUntilLedgerSeq, networkPassphrase);
  return signed.toXDR('base64');
}

export async function signOwnerAction(transactionXdr, networkPassphrase) {
  const owner = await unlockedOwnerKeypair();
  const transaction = new StellarSdk.Transaction(transactionXdr, networkPassphrase);
  if (transaction.source !== owner.publicKey()) throw new Error('Prepared action is not for this passkey vault');
  transaction.sign(owner);
  return transaction.toXDR();
}

/** Prepare, passkey-sign, and relay one narrowly scoped on-chain owner action. */
export async function submitPasskeyOwnerAction(action) {
  const { data: prepared } = await api.post('/wallet/actions/prepare', action);
  const { data: chain } = await api.get('/wallet/chain-config');
  const signedTransactionXdr = await signOwnerAction(prepared.transactionXdr, chain.networkPassphrase);
  const { data } = await api.post(`/wallet/actions/${prepared.actionId}/submit`, { signedTransactionXdr });
  return { ...data, summary: prepared.summary };
}
