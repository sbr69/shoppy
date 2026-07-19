import axios from 'axios';

// Development uses Vite's proxy. In production, the default is Vercel's
// same-origin `/api` rewrite, so browser DNS never needs to resolve the
// private API host directly. An explicit VITE_API_URL remains supported for
// alternate deployments.
const configuredApiOrigin = import.meta.env.VITE_API_URL?.replace(/\/$/, '');
const API_BASE = import.meta.env.DEV || !configuredApiOrigin
  ? '/api'
  : `${configuredApiOrigin}/api`;

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT to every request if available
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('jarvispays_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses — clear token and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/')) {
      sessionStorage.removeItem('jarvispays_token');
      sessionStorage.removeItem('jarvispays_user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default api;
