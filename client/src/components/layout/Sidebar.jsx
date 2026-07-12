import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState(null);
  const [funding, setFunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sites, setSites] = useState([]);

  useEffect(() => {
    fetchWallet();
    fetchSites();
  }, []);

  const fetchWallet = async () => {
    try {
      const { data } = await api.get('/wallet');
      setWallet(data);
    } catch (err) {
      console.error('Wallet error:', err);
    }
  };

  const fetchSites = async () => {
    try {
      const { data } = await api.get('/sites');
      setSites(data.sites || []);
    } catch {
      // Sites endpoint may not exist yet - that's ok
      setSites([]);
    }
  };

  const handleFund = async () => {
    try {
      setFunding(true);
      await api.post('/wallet/fund');
      await fetchWallet();
    } catch (err) {
      console.error('Fund error:', err);
    } finally {
      setFunding(false);
    }
  };

  const handleCopy = async () => {
    if (wallet?.publicKey) {
      await navigator.clipboard.writeText(wallet.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const truncateAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-6)}` : '';

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="navbar-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <div className="navbar-logo-icon">⚡</div>
            <span>JarvisPayz</span>
          </div>
          <button className="sidebar-user-btn" title={user?.email}>
            {user?.avatarUrl && (
              <img src={user.avatarUrl} alt={user.name} referrerPolicy="no-referrer" />
            )}
          </button>
        </div>

        {/* Wallet */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Wallet</div>
          <div className="sidebar-wallet">
            <div className="sidebar-wallet-balance">
              <span className="sidebar-wallet-amount">
                {wallet?.funded
                  ? parseFloat(wallet.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '0.00'
                }
              </span>
              <span className="sidebar-wallet-unit">XLM</span>
            </div>
            <div
              className="sidebar-wallet-address"
              onClick={handleCopy}
              title="Click to copy full address"
            >
              {copied ? '✓ Copied!' : truncateAddr(wallet?.publicKey)}
            </div>
            <div className="sidebar-wallet-actions">
              <button
                className="btn btn-primary"
                onClick={handleFund}
                disabled={funding}
              >
                {funding ? '...' : '☄️ Fund'}
              </button>
              <a
                href={wallet?.publicKey ? `https://stellar.expert/explorer/testnet/account/${wallet.publicKey}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                Explorer ↗
              </a>
            </div>
          </div>
        </div>

        {/* Connected Sites */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Connected Stores</div>
          <div className="sidebar-sites-list">
            {sites.length > 0 ? (
              sites.map((site) => (
                <div key={site.id} className="sidebar-site-item">
                  <div className="sidebar-site-favicon">🏪</div>
                  <div className="sidebar-site-info">
                    <div className="sidebar-site-name">{site.site_name}</div>
                    <div className="sidebar-site-url">{site.site_url}</div>
                  </div>
                  <div className="sidebar-site-status" />
                </div>
              ))
            ) : (
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-tertiary)',
                textAlign: 'center',
                padding: 'var(--space-3)',
              }}>
                No stores connected yet
              </div>
            )}
            <button className="sidebar-add-site" id="add-site-btn">
              + Connect Store
            </button>
          </div>
        </div>

        {/* Settings Quick Links */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Settings</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            Spending caps and store management coming in the next update.
          </div>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <button className="btn btn-ghost" onClick={handleLogout}>
            🚪 Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
