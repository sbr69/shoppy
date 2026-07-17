import { Router } from 'express';
import config from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import {
  fundAgentWalletWithFriendbot,
  fundWalletWithFriendbot,
  getAgentWalletByUserId,
  getWalletBalance,
  getWalletByUserId,
} from '../services/wallet.service.js';
import {
  createPasskeyRegistrationOptions,
  createPasskeyUnlockOptions,
  provisionPasskeyVault,
  verifyPasskeyRegistration,
  verifyPasskeyUnlock,
} from '../services/passkey-vault.service.js';
import getDb from '../db/database.js';
import { getUserSites } from '../services/site.service.js';
import { prepareOwnerAction, submitOwnerAction } from '../services/soroban.service.js';

const router = Router();

function requestUser(req) {
  return { id: req.user.userId, email: req.user.email, name: req.user.name };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const wallet = await getWalletByUserId(req.user.userId);
    const agent = await getAgentWalletByUserId(req.user.userId);
    if (!wallet || wallet.status !== 'active' || !wallet.public_key) {
      return res.json({
        vaultSetupRequired: true,
        passkeyConfigured: Boolean(wallet?.passkey_credential_id),
        publicKey: null,
        agentPublicKey: agent?.public_key || null,
        network: config.stellarNetwork,
      });
    }
    let balanceInfo;
    let networkAvailable = true;
    try {
      balanceInfo = await getWalletBalance(wallet.public_key);
    } catch (error) {
      console.warn('Stellar Horizon unavailable:', error.message);
      balanceInfo = { balance: '0', funded: false };
      networkAvailable = false;
    }
    return res.json({
      publicKey: wallet.public_key,
      agentPublicKey: agent?.public_key || null,
      balance: balanceInfo.balance,
      funded: balanceInfo.funded,
      networkAvailable,
      vaultSetupRequired: false,
      passkeyConfigured: true,
      createdAt: wallet.created_at,
      provisionedAt: wallet.provisioned_at,
      network: config.stellarNetwork,
    });
  } catch (error) {
    console.error('Wallet fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch wallet info' });
  }
});

/** Public configuration only; it contains no key material. */
router.get('/chain-config', authenticate, async (req, res) => {
  const agent = await getAgentWalletByUserId(req.user.userId);
  res.json({
    network: config.stellarNetwork,
    networkPassphrase: config.stellarNetworkPassphrase,
    sorobanRpcUrl: config.sorobanRpcUrl,
    trustListContractId: config.trustListContractId || null,
    spendGuardContractId: config.spendGuardContractId || null,
    settlementTokenContractId: config.settlementTokenContractId || null,
    agentPublicKey: agent?.public_key || null,
  });
});

router.post('/vault/registration/options', authenticate, async (req, res) => {
  try {
    res.json(await createPasskeyRegistrationOptions(requestUser(req)));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/vault/registration/verify', authenticate, async (req, res) => {
  try {
    const result = await verifyPasskeyRegistration(requestUser(req), req.body?.credential);
    res.status(201).json(result);
  } catch (error) {
    console.warn('Passkey registration failed:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post('/vault/unlock/options', authenticate, async (req, res) => {
  try {
    res.json(await createPasskeyUnlockOptions(req.user.userId));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/vault/unlock/verify', authenticate, async (req, res) => {
  try {
    res.json(await verifyPasskeyUnlock(req.user.userId, req.body?.credential));
  } catch (error) {
    console.warn('Passkey unlock failed:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post('/vault/provision', authenticate, async (req, res) => {
  try {
    const wallet = await provisionPasskeyVault(req.user.userId, req.body);
    res.status(201).json({ wallet });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/** Testnet only. Friendbot funds the browser-owned account and a fee-only agent signer. */
router.post('/fund', authenticate, async (req, res) => {
  try {
    const wallet = await getWalletByUserId(req.user.userId);
    if (!wallet?.public_key || wallet.status !== 'active') {
      return res.status(409).json({ error: 'Set up your passkey vault before funding a wallet' });
    }
    const [owner, agent] = await Promise.all([
      fundWalletWithFriendbot(wallet.public_key),
      fundAgentWalletWithFriendbot(req.user.userId),
    ]);
    return res.json({ ...owner, agent });
  } catch (error) {
    console.error('Wallet fund error:', error.message);
    return res.status(500).json({ error: 'Failed to fund testnet wallet' });
  }
});

/**
 * Prepare a contract action for browser signing. The server stores the exact
 * unsigned envelope and relays only a transaction with the identical body and
 * a valid owner signature; it cannot sign on the owner's behalf.
 */
router.post('/actions/prepare', authenticate, async (req, res) => {
  try {
    const actionType = req.body?.actionType;
    if (!['set_agent', 'set_trust_rule', 'deposit'].includes(actionType)) {
      return res.status(400).json({ error: 'Unsupported owner action' });
    }
    const [wallet, agent] = await Promise.all([
      getWalletByUserId(req.user.userId),
      getAgentWalletByUserId(req.user.userId),
    ]);
    if (!wallet?.public_key || wallet.status !== 'active' || !agent?.public_key) {
      return res.status(409).json({ error: 'Complete passkey vault setup before signing an on-chain action' });
    }
    let site;
    if (actionType === 'set_trust_rule') {
      const sites = await getUserSites(req.user.userId);
      site = sites.find((candidate) => candidate.id === req.body?.siteId);
      if (!site) return res.status(404).json({ error: 'Site not found' });
    }
    const prepared = await prepareOwnerAction({
      actionType,
      ownerPublicKey: wallet.public_key,
      agentPublicKey: agent.public_key,
      site,
      amountXlm: req.body?.amountXlm,
    });
    const [action] = await getDb()`
      insert into wallet_actions (user_id, action_type, payload, transaction_xdr, expires_at)
      values (${req.user.userId}, ${actionType}, ${getDb().json(prepared.summary)}, ${prepared.transactionXdr}, ${prepared.expiresAt})
      returning id, expires_at`;
    res.status(201).json({ actionId: action.id, transactionXdr: prepared.transactionXdr, expiresAt: action.expires_at, summary: prepared.summary });
  } catch (error) {
    console.error('Owner action preparation failed:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post('/actions/:id/submit', authenticate, async (req, res) => {
  try {
    const [action, wallet] = await Promise.all([
      getDb()`select * from wallet_actions where id = ${req.params.id} and user_id = ${req.user.userId}`.then(([row]) => row),
      getWalletByUserId(req.user.userId),
    ]);
    if (!action) return res.status(404).json({ error: 'Prepared owner action not found' });
    if (action.state !== 'prepared' || new Date(action.expires_at).getTime() <= Date.now()) {
      await getDb()`update wallet_actions set state = 'expired' where id = ${action.id} and state = 'prepared'`;
      return res.status(409).json({ error: 'Prepared owner action expired. Create a new one.' });
    }
    const submitted = await submitOwnerAction({
      signedTransactionXdr: req.body?.signedTransactionXdr,
      preparedTransactionXdr: action.transaction_xdr,
      ownerPublicKey: wallet?.public_key,
    });
    await getDb().begin(async (tx) => {
      await tx`update wallet_actions set state = 'submitted', submitted_tx_hash = ${submitted.txHash}, submitted_at = now() where id = ${action.id}`;
      await tx`insert into audit_events (user_id, event_type, payload) values (${req.user.userId}, 'owner_action_submitted', ${tx.json({ actionId: action.id, actionType: action.action_type, txHash: submitted.txHash })})`;
    });
    res.status(202).json({ ...submitted, actionId: action.id });
  } catch (error) {
    console.error('Owner action submission failed:', error.message);
    res.status(400).json({ error: error.message });
  }
});

export default router;
