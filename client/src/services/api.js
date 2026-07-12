import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
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
    if (error.response?.status === 401) {
      sessionStorage.removeItem('jarvispays_token');
      sessionStorage.removeItem('jarvispays_user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default api;
