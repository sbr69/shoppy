import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { encrypt, decrypt } from './crypto.service.js';
import { deployAgentSmartWallet, fundAgentSmartWallet, getAgentSmartWalletBalance, withdrawAgentSmartWallet } from './soroban.service.js';

function encodedCiphertext(secretKey, keyScope) {
  const { encrypted, iv, authTag } = encrypt(secretKey, keyScope);
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function agentScope(googleSub) {
  return `agent-signer:${googleSub}`;
}

/**
 * Create the constrained agent signer. It can only spend through the C...
 * wallet's on-chain policy and each purchase additionally needs the separate
 * owner authorization for that exact contract invocation.
 */
export async function ensureAgentWalletForUser(userId, googleSub) {
  const db = getDb();
  const [existing] = await db`select public_key from agent_wallets where user_id = ${userId}`;
  if (existing) return { agentPublicKey: existing.public_key };

  const agent = StellarSdk.Keypair.random();
  const ciphertext = encodedCiphertext(agent.secret(), agentScope(googleSub));
  await db`
    insert into agent_wallets (user_id, public_key, encrypted_secret, iv, auth_tag, key_version)
    values (${userId}, ${agent.publicKey()}, ${ciphertext.encrypted}, ${ciphertext.iv}, ${ciphertext.authTag}, ${config.encryptionKeyVersion})`;
  return { agentPublicKey: agent.publicKey() };
}

/** Create the user-visible custodial wallet only when none exists. */
export async function ensureCustodialWalletForUser(userId, googleSub) {
  const db = getDb();
  const [existing] = await db`select public_key, encrypted_secret, status from wallets where user_id = ${userId}`;
  if (existing?.public_key && existing.encrypted_secret && existing.status === 'active') return { publicKey: existing.public_key };
  const owner = StellarSdk.Keypair.random();
  const ciphertext = encodedCiphertext(owner.secret(), `owner-wallet:${googleSub}`);
  const [wallet] = await db`
    insert into wallets (user_id, public_key, encrypted_secret, iv, auth_tag, key_version, custody_mode, status, provisioned_at)
    values (${userId}, ${owner.publicKey()}, ${ciphertext.encrypted}, ${ciphertext.iv}, ${ciphertext.authTag}, ${config.encryptionKeyVersion}, 'server_custody', 'active', now())
    on conflict (user_id) do update set public_key = excluded.public_key, encrypted_secret = excluded.encrypted_secret,
      iv = excluded.iv, auth_tag = excluded.auth_tag, key_version = excluded.key_version, custody_mode = 'server_custody',
      status = 'active', provisioned_at = now()
    returning public_key`;
  return { publicKey: wallet.public_key };
}

export async function getWalletByUserId(userId) {
  const [wallet] = await getDb()`
    select public_key, status, custody_mode, passkey_credential_id, provisioned_at, created_at
    from wallets where user_id = ${userId}`;
  return wallet;
}

export async function getVaultRecord(userId) {
  const [wallet] = await getDb()`
    select public_key, status, custody_mode, vault_ciphertext, vault_iv, vault_salt,
           passkey_credential_id, provisioned_at
    from wallets where user_id = ${userId}`;
  return wallet;
}

export async function getAgentWalletByUserId(userId) {
  const [wallet] = await getDb()`select public_key, status, created_at from agent_wallets where user_id = ${userId}`;
  return wallet;
}

/** The C... policy-controlled wallet that holds the user's spendable funds. */
export async function getAgentSmartWalletByUserId(userId) {
  const [wallet] = await getDb()`select contract_id, wasm_hash, deployment_tx_hash, status, created_at from agent_smart_wallets where user_id = ${userId}`;
  return wallet;
}

export async function provisionAgentSmartWalletForUser(userId, googleSub) {
  const existing = await getAgentSmartWalletByUserId(userId);
  if (existing?.status === 'active') return existing;

  const [owner, agent, ownerKeypair, agentKeypair] = await Promise.all([
    getWalletByUserId(userId),
    getAgentWalletByUserId(userId),
    getOwnerKeypairForSigning(userId, googleSub),
    getAgentKeypairForSigning(userId, googleSub),
  ]);
  if (!owner?.public_key || owner.status !== 'active' || !agent?.public_key || agent.status !== 'active') {
    throw new Error('Custodial funding and agent fee accounts must be active before creating the smart wallet');
  }
  // Deployer must be an existing funded account; this is verified by the
  // Soroban RPC when it prepares the deployment. Keep the agent keypair load
  // above so we fail early if the fee payer has not been provisioned.
  void agentKeypair;
  const deployed = await deployAgentSmartWallet({
    ownerKeypair,
    ownerPublicKey: owner.public_key,
    agentPublicKey: agent.public_key,
  });
  const db = getDb();
  const [smartWallet] = await db`
    insert into agent_smart_wallets (user_id, contract_id, wasm_hash, deployment_tx_hash, status)
    values (${userId}, ${deployed.contractId}, ${config.agentWalletWasmHash}, ${deployed.txHash}, 'active')
    on conflict (user_id) do update set contract_id = excluded.contract_id, wasm_hash = excluded.wasm_hash,
      deployment_tx_hash = excluded.deployment_tx_hash, status = 'active', updated_at = now()
    returning contract_id, wasm_hash, deployment_tx_hash, status, created_at`;
  return smartWallet;
}

/**
 * Move a wallet to a newer immutable contract code hash without moving funds
 * through a merchant or an escrow. The durable migration record means that a
 * transient RPC/database failure can be recovered without guessing where the
 * user's balance went.
 */
export async function migrateAgentSmartWalletForUser(userId, googleSub) {
  const current = await getAgentSmartWalletByUserId(userId);
  if (!current?.contract_id || current.status !== 'active') throw new Error('No active Agent Smart Wallet is available to migrate');
  if (current.wasm_hash === config.agentWalletWasmHash) return { smartWallet: current, migrated: false };

  const [owner, agent, ownerKeypair] = await Promise.all([
    getWalletByUserId(userId),
    getAgentWalletByUserId(userId),
    getOwnerKeypairForSigning(userId, googleSub),
  ]);
  if (!owner?.public_key || owner.status !== 'active' || !agent?.public_key || agent.status !== 'active') {
    throw new Error('Custodial wallet accounts are not ready for migration');
  }

  const deployed = await deployAgentSmartWallet({
    ownerKeypair,
    ownerPublicKey: owner.public_key,
    agentPublicKey: agent.public_key,
  });
  const db = getDb();
  const [migration] = await db`
    insert into agent_smart_wallet_migrations (user_id, from_contract_id, to_contract_id, to_wasm_hash, deployment_tx_hash, status)
    values (${userId}, ${current.contract_id}, ${deployed.contractId}, ${config.agentWalletWasmHash}, ${deployed.txHash}, 'deployed')
    returning id, to_contract_id`;

  try {
    const balance = await getAgentSmartWalletBalance({ smartWalletId: current.contract_id, sourcePublicKey: owner.public_key });
    let transfer = null;
    if (BigInt(balance) > 0n) {
      transfer = await withdrawAgentSmartWallet({
        smartWalletId: current.contract_id,
        ownerKeypair,
        ownerPublicKey: owner.public_key,
        recipient: deployed.contractId,
        amountXlm: fromStroops(BigInt(balance)),
      });
    }
    await db.begin(async (tx) => {
      await tx`update agent_smart_wallet_migrations set status = 'funds_transferred', transfer_tx_hash = ${transfer?.txHash || null}, updated_at = now() where id = ${migration.id}`;
      await tx`update agent_smart_wallets set contract_id = ${deployed.contractId}, wasm_hash = ${config.agentWalletWasmHash}, deployment_tx_hash = ${deployed.txHash}, status = 'active', updated_at = now() where user_id = ${userId}`;
      await tx`update agent_smart_wallet_migrations set status = 'completed', completed_at = now(), updated_at = now() where id = ${migration.id}`;
    });
    const smartWallet = await getAgentSmartWalletByUserId(userId);
    return { smartWallet, migrated: true, migrationId: migration.id, transferTxHash: transfer?.txHash || null };
  } catch (error) {
    await db`update agent_smart_wallet_migrations set status = 'failed', last_error = ${error.message}, updated_at = now() where id = ${migration.id}`;
    throw error;
  }
}

function toStroops(value) {
  const [whole, fraction = ''] = String(value).split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) throw new Error('Invalid XLM balance');
  return BigInt(whole) * 10_000_000n + BigInt(`${fraction}0000000`.slice(0, 7));
}

function fromStroops(value) {
  const whole = value / 10_000_000n;
  const fraction = (value % 10_000_000n).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}

/**
 * Friendbot funds the internal G... funding account; this moves all but a
 * small reserve into the user-visible C... smart wallet in one owner-authorized
 * transaction. It is funding-time setup, never a hidden per-purchase escrow.
 */
export async function fundAgentSmartWalletFromCustody(userId, googleSub) {
  const [owner, smartWallet, ownerKeypair] = await Promise.all([
    getWalletByUserId(userId),
    provisionAgentSmartWalletForUser(userId, googleSub),
    getOwnerKeypairForSigning(userId, googleSub),
  ]);
  if (!owner?.public_key) throw new Error('Custodial funding account is unavailable');
  const balance = await getWalletBalance(owner.public_key);
  const reserve = 100_000_000n; // Keep 10 XLM for Soroban resource fees and recovery.
  const available = toStroops(balance.balance) - reserve;
  if (available <= 0n) {
    return { smartWallet, fundedAmountXlm: '0.0000000', alreadyFunded: true, transfer: null };
  }
  const transfer = await fundAgentSmartWallet({
    smartWalletId: smartWallet.contract_id,
    ownerKeypair,
    ownerPublicKey: owner.public_key,
    amountXlm: fromStroops(available),
  });
  return { smartWallet, fundedAmountXlm: fromStroops(available), alreadyFunded: false, transfer };
}

export async function getAgentSmartWalletBalanceForUser(userId) {
  const [owner, smartWallet] = await Promise.all([getWalletByUserId(userId), getAgentSmartWalletByUserId(userId)]);
  if (!smartWallet || smartWallet.status !== 'active' || !owner?.public_key) return { balance: '0', funded: false, smartWallet: null };
  const stroops = await getAgentSmartWalletBalance({ smartWalletId: smartWallet.contract_id, sourcePublicKey: owner.public_key });
  return { balance: fromStroops(BigInt(stroops)), funded: BigInt(stroops) > 0n, smartWallet };
}

export async function getWalletBalance(publicKey) {
  try {
    const account = await new StellarSdk.Horizon.Server(config.horizonUrl).loadAccount(publicKey);
    const nativeBalance = account.balances.find((balance) => balance.asset_type === 'native');
    return { balance: nativeBalance ? nativeBalance.balance : '0', funded: true };
  } catch (error) {
    if (error?.response?.status === 404) return { balance: '0', funded: false };
    throw error;
  }
}

export async function fundWalletWithFriendbot(publicKey) {
  if (config.stellarNetwork !== 'testnet') throw new Error('Friendbot is disabled outside Stellar testnet');
  const response = await fetch(`${config.friendbotUrl}?addr=${publicKey}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && text.includes('createAccountAlreadyExist')) {
      return { success: true, message: 'Account already funded', alreadyFunded: true };
    }
    throw new Error(`Friendbot error: ${response.status}`);
  }
  const result = await response.json();
  return { success: true, message: 'Account funded with test XLM', txHash: result.hash, alreadyFunded: false };
}

/** The agent needs a small testnet account balance to submit Soroban fees. */
export async function fundAgentWalletWithFriendbot(userId) {
  const agent = await getAgentWalletByUserId(userId);
  if (!agent) throw new Error('Agent signer is not configured');
  return fundWalletWithFriendbot(agent.public_key);
}

export async function getAgentKeypairForSigning(userId, googleSub) {
  const [wallet] = await getDb()`
    select encrypted_secret, iv, auth_tag, key_version, status from agent_wallets where user_id = ${userId}`;
  if (!wallet || wallet.status !== 'active') throw new Error('Agent signing key is not active');
  if (wallet.key_version !== config.encryptionKeyVersion) throw new Error('Agent signing key requires rotation before use');
  const secretKey = decrypt(
    Buffer.from(wallet.encrypted_secret, 'base64'),
    Buffer.from(wallet.iv, 'base64'),
    Buffer.from(wallet.auth_tag, 'base64'),
    agentScope(googleSub),
  );
  return StellarSdk.Keypair.fromSecret(secretKey);
}

export async function getOwnerKeypairForSigning(userId, googleSub) {
  const [wallet] = await getDb()`select encrypted_secret, iv, auth_tag, key_version, status from wallets where user_id = ${userId}`;
  if (!wallet?.encrypted_secret || wallet.status !== 'active') throw new Error('Custodial wallet is not active');
  if (wallet.key_version !== config.encryptionKeyVersion) throw new Error('Custodial wallet key requires rotation before use');
  const secretKey = decrypt(Buffer.from(wallet.encrypted_secret, 'base64'), Buffer.from(wallet.iv, 'base64'), Buffer.from(wallet.auth_tag, 'base64'), `owner-wallet:${googleSub}`);
  return StellarSdk.Keypair.fromSecret(secretKey);
}
