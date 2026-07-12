import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import WalletCard from '../components/WalletCard';

export default function Dashboard() {
  const { user, isAuthenticated, loading, loginWithGoogle, logout } = useAuth();
  const navigate = useNavigate();

  // If not authenticated and not loading, show login prompt
  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner-lg" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
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
              <div className="navbar-logo-icon">⚡</div>
              <span>JarvisPayz</span>
            </div>
            <h2>Welcome Back</h2>
            <p>Sign in with Google to access your AI shopping agent and Stellar wallet.</p>
          </div>

          <div className="login-card-body">
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

  // Authenticated — show dashboard
  return (
    <div className="dashboard">
      {/* Top bar */}
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <div className="navbar-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <div className="navbar-logo-icon">⚡</div>
            <span>JarvisPayz</span>
          </div>

          <div className="dashboard-user">
            {user?.avatarUrl && (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="dashboard-avatar"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="dashboard-user-info">
              <span className="dashboard-user-name">{user?.name}</span>
              <span className="dashboard-user-email">{user?.email}</span>
            </div>
            <button
              className="btn btn-ghost"
              onClick={logout}
              id="logout-btn"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="dashboard-main">
        <div className="dashboard-welcome">
          <h1>Welcome, {user?.name?.split(' ')[0]} 👋</h1>
          <p>Your AI shopping agent is ready. Fund your wallet and start shopping.</p>
        </div>

        <div className="dashboard-grid">
          {/* Wallet */}
          <WalletCard />

          {/* Quick Start Guide */}
          <div className="quickstart-card glass-card">
            <div className="quickstart-header">
              <span className="quickstart-icon">🚀</span>
              <h3>Quick Start</h3>
            </div>
            <div className="quickstart-steps">
              <div className="quickstart-step">
                <div className={`quickstart-step-number completed`}>✓</div>
                <div className="quickstart-step-content">
                  <h4>Sign in with Google</h4>
                  <p>You're all set!</p>
                </div>
              </div>
              <div className="quickstart-step">
                <div className="quickstart-step-number">2</div>
                <div className="quickstart-step-content">
                  <h4>Fund your wallet</h4>
                  <p>Click "Fund with Friendbot" to get testnet XLM.</p>
                </div>
              </div>
              <div className="quickstart-step">
                <div className="quickstart-step-number">3</div>
                <div className="quickstart-step-content">
                  <h4>Connect a store</h4>
                  <p>Add an e-commerce site for the agent to shop from.</p>
                </div>
              </div>
              <div className="quickstart-step">
                <div className="quickstart-step-number">4</div>
                <div className="quickstart-step-content">
                  <h4>Start chatting</h4>
                  <p>Tell the agent what to buy — it handles the rest.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
