import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { Lightning } from '@phosphor-icons/react';
import AppLayout from '../components/layout/AppLayout';

export default function Dashboard() {
  const { user, isAuthenticated, loading, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

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
          <div className="navbar-logo" style={{ justifyContent: 'center' }}>
            <div className="navbar-logo-icon">
              <Lightning size={18} weight="fill" />
            </div>
            <span>JarvisPayz</span>
          </div>
          <h2>Welcome Back</h2>
          <p>Sign in with Google to access your AI shopping agent and Stellar wallet.</p>
        </div>

        <div className="login-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <GoogleLogin
            onSuccess={async (credentialResponse) => {
              try {
                await loginWithGoogle(credentialResponse.credential);
              } catch (err) {
                console.error('Login error:', err);
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

          <div style={{ display: 'flex', alignItems: 'center', width: '100%', margin: '4px 0' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-default)' }} />
            <span style={{ padding: '0 12px', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-default)' }} />
          </div>

          <button
            className="btn btn-secondary"
            style={{ width: '100%', maxWidth: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}
            onClick={async () => {
              try {
                await loginWithGoogle('mock-dev-token');
              } catch (err) {
                console.error('Mock login error:', err);
              }
            }}
            id="mock-login-btn"
          >
            <Lightning size={14} weight="fill" />
            Continue in Developer Mode
          </button>
        </div>

        <div className="login-card-footer">
          <p>
            Your Stellar wallet is created automatically.
            <br />
            No extensions or seed phrases needed.
          </p>
        </div>
      </div>
    </div>
  );
}
