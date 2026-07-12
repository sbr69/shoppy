import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const savedToken = sessionStorage.getItem('jarvispays_token');
    const savedUser = sessionStorage.getItem('jarvispays_user');

    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  /**
   * Login with Google credential (ID token from Google Sign-In).
   */
  const loginWithGoogle = useCallback(async (credential) => {
    const { data } = await api.post('/auth/google', { credential });

    // Store in sessionStorage (cleared when tab closes)
    sessionStorage.setItem('jarvispays_token', data.token);
    sessionStorage.setItem('jarvispays_user', JSON.stringify(data.user));

    setToken(data.token);
    setUser(data.user);

    return data;
  }, []);

  /**
   * Logout — clear session.
   */
  const logout = useCallback(() => {
    sessionStorage.removeItem('jarvispays_token');
    sessionStorage.removeItem('jarvispays_user');
    setToken(null);
    setUser(null);
  }, []);

  const isAuthenticated = !!token;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated,
        loginWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
