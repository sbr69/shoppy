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
      let oauth = null;
      if (store.oauth) {
        if (!store.oauth.authorizationUrl || !store.oauth.tokenUrl || !store.oauth.clientId) throw new Error(`${store.id}.oauth needs authorizationUrl, tokenUrl, and clientId`);
        oauth = {
          authorizationUrl: new URL(store.oauth.authorizationUrl).toString(),
          tokenUrl: new URL(store.oauth.tokenUrl).toString(),
          clientId: String(store.oauth.clientId),
          clientSecret: store.oauth.clientSecret ? String(store.oauth.clientSecret) : null,
          scopes: Array.isArray(store.oauth.scopes) ? store.oauth.scopes.map(String) : [],
        };
      }
      return { ...store, origin, apiBaseUrl, oauth };
    });
  } catch (error) {
    throw new Error(`SUPPORTED_STORES_JSON is invalid: ${error.message}`);
  }
}

function boundedRate(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = requireProductionSecret('JWT_SECRET', process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', 'dev-jwt-secret-change-in-production');
const masterSecret = requireProductionSecret('MASTER_SECRET', process.env.MASTER_SECRET || 'dev-master-secret-change-in-production', 'dev-master-secret-change-in-production');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const serverPublicUrl = process.env.SERVER_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
try { new URL(clientUrl); } catch { throw new Error('CLIENT_URL must be a valid origin'); }

const config = {
  port: process.env.PORT || 3001,
  clientUrl,
  serverPublicUrl: new URL(serverPublicUrl).origin,
  nodeEnv,

  // Gemini API
  geminiApiKey: process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY',

  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',

  // JWT
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30m',

  // Encryption for server-custodial signing material and merchant OAuth tokens.
  masterSecret,
  encryptionKeyVersion: 1,

  // Supabase transaction-pooler URI. It is server-only and must never be sent
  // to the client or committed to source control.
  supabaseDbUrl: process.env.SUPABASE_DB_URL,
  databasePoolMax: Number.parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  sentryDsn: process.env.SENTRY_DSN || '',
  sentryTracesSampleRate: boundedRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),

  // Stellar
  stellarNetwork: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: process.env.STELLAR_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  friendbotUrl: process.env.STELLAR_FRIENDBOT_URL || 'https://friendbot.stellar.org',
  stellarNetworkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  trustListContractId: process.env.TRUSTLIST_CONTRACT_ID || '',
  spendGuardContractId: process.env.SPENDGUARD_CONTRACT_ID || '',
  agentWalletWasmHash: process.env.AGENT_WALLET_WASM_HASH || '',
  settlementTokenContractId: process.env.SETTLEMENT_TOKEN_CONTRACT_ID || '',

  // A store must be explicitly registered before the agent can access it.
  // This intentionally replaces arbitrary URL scraping for purchase flows.
  supportedStores: parseSupportedStores(process.env.SUPPORTED_STORES_JSON),
};

if (!Number.isInteger(config.databasePoolMax) || config.databasePoolMax < 1 || config.databasePoolMax > 50) {
  throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 50');
}
if (nodeEnv === 'production') {
  for (const [name, value] of Object.entries({ SUPABASE_DB_URL: config.supabaseDbUrl, TRUSTLIST_CONTRACT_ID: config.trustListContractId, AGENT_WALLET_WASM_HASH: config.agentWalletWasmHash, SETTLEMENT_TOKEN_CONTRACT_ID: config.settlementTokenContractId })) {
    if (!value) throw new Error(`${name} is required in production`);
  }
  if (!config.serverPublicUrl.startsWith('https://')) throw new Error('SERVER_PUBLIC_URL must use HTTPS in production');
}

export default config;
