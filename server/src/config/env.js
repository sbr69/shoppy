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

const config = {
  port: process.env.PORT || 3001,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  nodeEnv,

  // Gemini API
  geminiApiKey: process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY',

  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',

  // JWT
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30m',

  // Encryption — master secret for deriving per-user encryption keys
  masterSecret,
  encryptionKeyVersion: 1,

  // Stellar
  stellarNetwork: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',

  // A store must be explicitly registered before the agent can access it.
  // This intentionally replaces arbitrary URL scraping for purchase flows.
  supportedStores: parseSupportedStores(process.env.SUPPORTED_STORES_JSON),
};

export default config;
