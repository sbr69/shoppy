import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Stellar Wallets Kit and some supported wallet transports expect the
  // browser-compatible Buffer/global shims that Vite deliberately omits.
  // This keeps the SDK browser-only without exposing Node APIs to the app.
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
