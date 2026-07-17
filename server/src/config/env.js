import dotenv from 'dotenv';
dotenv.config();

function requireProductionSecret(name, value, insecureDefault) {
  if (process.env.NODE_ENV === 'production' && (!value || value === insecureDefault)) {
    throw new Error(`${name} must be set to a strong secret in production`);
  }
  return value;
}

function parseSupportedStores(value) {
  if (!value) return [];
  try {
    const stores = JSON.parse(value);
    if (!Array.isArray(stores)) throw new Error('must be an array');
    return stores.map((store) => {
      if (!store.id || !store.name || !store.origin || !store.apiBaseUrl || !store.merchantStellarAddress) {
        throw new Error('each store needs id, name, origin, apiBaseUrl, and merchantStellarAddress');
      }
      const origin = new URL(store.origin).origin;
      const apiBaseUrl = new URL(store.apiBaseUrl).origin;
      return { ...store, origin, apiBaseUrl };
    });
  } catch (error) {
    throw new Error(`SUPPORTED_STORES_JSON is invalid: ${error.message}`);
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = requireProductionSecret('JWT_SECRET', process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', 'dev-jwt-secret-change-in-production');
const masterSecret = requireProductionSecret('MASTER_SECRET', process.env.MASTER_SECRET || 'dev-master-secret-change-in-production', 'dev-master-secret-change-in-production');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
let defaultPasskeyRpId;
try {
  defaultPasskeyRpId = new URL(clientUrl).hostname;
} catch {
  throw new Error('CLIENT_URL must be a valid origin');
}

const config = {
  port: process.env.PORT || 3001,
  clientUrl,
  nodeEnv,

  // Gemini API
  geminiApiKey: process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY',

  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',

  // JWT
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30m',

  // Encryption — used only for the backend's constrained agent signer. Owner
  // wallet secrets are passkey-encrypted in the browser and are never sent here.
  masterSecret,
  encryptionKeyVersion: 1,

  // Supabase transaction-pooler URI. It is server-only and must never be sent
  // to the client or committed to source control.
  supabaseDbUrl: process.env.SUPABASE_DB_URL,
  databasePoolMax: Number.parseInt(process.env.DATABASE_POOL_MAX || '10', 10),

  // Stellar
  stellarNetwork: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: process.env.STELLAR_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  friendbotUrl: process.env.STELLAR_FRIENDBOT_URL || 'https://friendbot.stellar.org',
  stellarNetworkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  trustListContractId: process.env.TRUSTLIST_CONTRACT_ID || '',
  spendGuardContractId: process.env.SPENDGUARD_CONTRACT_ID || '',
  settlementTokenContractId: process.env.SETTLEMENT_TOKEN_CONTRACT_ID || '',

  // WebAuthn passkey vault. The RP ID must be the hostname of the browser
  // origin (or a registrable parent domain in production).
  passkeyRpId: process.env.PASSKEY_RP_ID || defaultPasskeyRpId,
  passkeyOrigin: process.env.PASSKEY_ORIGIN || clientUrl,
  passkeyRpName: process.env.PASSKEY_RP_NAME || 'JarvisPayz',

  // A store must be explicitly registered before the agent can access it.
  // This intentionally replaces arbitrary URL scraping for purchase flows.
  supportedStores: parseSupportedStores(process.env.SUPPORTED_STORES_JSON),
};

if (!Number.isInteger(config.databasePoolMax) || config.databasePoolMax < 1 || config.databasePoolMax > 50) {
  throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 50');
}
if (nodeEnv === 'production') {
  for (const [name, value] of Object.entries({ SUPABASE_DB_URL: config.supabaseDbUrl, TRUSTLIST_CONTRACT_ID: config.trustListContractId, SPENDGUARD_CONTRACT_ID: config.spendGuardContractId, SETTLEMENT_TOKEN_CONTRACT_ID: config.settlementTokenContractId })) {
    if (!value) throw new Error(`${name} is required in production`);
  }
  if (!config.passkeyOrigin.startsWith('https://')) throw new Error('PASSKEY_ORIGIN must use HTTPS in production');
}

export default config;
