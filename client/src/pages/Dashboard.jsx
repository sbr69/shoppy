import { useAuth } from '../contexts/AuthContext';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { Lightning } from '@phosphor-icons/react';
import AppLayout from '../components/layout/AppLayout';
import { useToast } from '../contexts/ToastContext';

export default function Dashboard() {
  const { isAuthenticated, loading, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [loginError, setLoginError] = useState('');
  const toast = useToast();

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('storeConnection');
    if (status === 'success') toast.success('Store connected. Your agent can now use its authorized API.');
    if (status === 'failed') toast.error('Store authorization did not complete. Please try connecting again.');
    if (status) window.history.replaceState({}, '', '/dashboard');
  }, [toast]);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner-lg" />
        <p>Loading...</p>
      </div>
    );
  }

  // Authenticated → show the main app (sidebar + chat)
  if (isAuthenticated) {
    return <AppLayout />;
  }

  // Not authenticated → show login
  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="hero-gradient-orb" />
        <div className="hero-gradient-orb" />
        <div className="hero-grid" />
      </div>

      <div className="login-card glass-card">
        <div className="login-card-header">
          <div className="navbar-logo" style={{ justifyContent: 'center', gap: '10px' }}>
            <img src="/logo.svg" alt="JarvisPayz Logo" style={{ width: 36, height: 36, display: 'block' }} />
            <span style={{ fontSize: '1.45rem', fontWeight: 700 }}>JarvisPayz</span>
          </div>
          <h2>Welcome Back</h2>
          <p>Sign in with Google to access your AI shopping agent and managed Stellar wallet.</p>
        </div>

        <div className="login-card-body">
          <GoogleLogin
            onSuccess={async (credentialResponse) => {
              try {
                setLoginError('');
                await loginWithGoogle(credentialResponse.credential);
                navigate('/dashboard', { replace: true });
              } catch (err) {
                console.error('Login error:', err);
                setLoginError(err.response?.data?.details || err.response?.data?.error || 'Unable to sign in. Please try again.');
              }
            }}
            onError={() => {
              console.error('Google Login Failed');
            }}
            theme="filled_black"
            size="large"
            width="320"
            text="signin_with"
            shape="pill"
          />
          {loginError && <p className="login-error" role="alert">{loginError}</p>}
        </div>

        <div className="login-card-footer">
          <p>
            Your Stellar wallet is created and connected automatically.
            <br />
            No extensions or seed phrases needed.
          </p>
        </div>
      </div>
    </div>
  );
}
