import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: process.env.PORT || 3001,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  jwtExpiresIn: '7d',

  // Encryption — master secret for deriving per-user encryption keys
  masterSecret: process.env.MASTER_SECRET || 'dev-master-secret-change-in-production',

  // Stellar
  stellarNetwork: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',

  // Merchant Stellar address (hardcoded for testing)
  merchantStellarAddress: process.env.MERCHANT_STELLAR_ADDRESS || 'GAS7MXJI3CIRUPZTA75VBMJXAJGUYCLBPHCTZQWGC7OTVSAKZN553WYX',
};

export default config;
