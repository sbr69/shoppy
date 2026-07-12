import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import ConnectSiteModal from '../settings/ConnectSiteModal';
import SettingsPanel from '../settings/SettingsPanel';

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    fetchWallet();
    fetchSites();
  }, []);

  const fetchWallet = async () => {
    try {
      setWalletLoading(true);
      const { data } = await api.get('/wallet');
      setWallet(data);
    } catch (err) {
      toast.error('Failed to load wallet');
    } finally {
      setWalletLoading(false);
    }
  };

  const fetchSites = async () => {
    try {
      setSitesLoading(true);
      const { data } = await api.get('/sites');
      setSites(data.sites || []);
    } catch {
      setSites([]);
    } finally {
      setSitesLoading(false);
    }
  };

  const handleFund = async () => {
    try {
      setFunding(true);
      const { data } = await api.post('/wallet/fund');
      await fetchWallet();
      if (data.alreadyFunded) {
        toast.info('Wallet already funded');
      } else {
        toast.success('Wallet funded with 10,000 XLM!');
      }
    } catch (err) {
      toast.error('Failed to fund wallet. Try again.');
    } finally {
      setFunding(false);
    }
  };

  const handleCopy = async () => {
    if (wallet?.publicKey) {
      try {
        await navigator.clipboard.writeText(wallet.publicKey);
        setCopied(true);
        toast.success('Address copied!');
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Failed to copy address');
      }
    }
  };

  const truncateAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-6)}` : '';

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleSiteAdded = (site) => {
    setSites(prev => [site, ...prev]);
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
          {walletLoading ? (
            <div className="sidebar-wallet">
              <div className="skeleton-line skeleton-lg" style={{ marginBottom: 8 }} />
              <div className="skeleton-line skeleton-sm" />
            </div>
          ) : (
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
                  {funding ? (
                    <><span className="spinner" /> Funding...</>
                  ) : (
                    '☄️ Fund'
                  )}
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
          )}
        </div>

        {/* Connected Sites */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Connected Stores ({sites.length})</div>
          <div className="sidebar-sites-list">
            {sitesLoading ? (
              <>
                <div className="skeleton-line" style={{ height: 48, borderRadius: 10 }} />
                <div className="skeleton-line" style={{ height: 48, borderRadius: 10 }} />
              </>
            ) : sites.length > 0 ? (
              sites.map((site) => (
                <div key={site.id} className="sidebar-site-item">
                  <div className="sidebar-site-favicon">🏪</div>
                  <div className="sidebar-site-info">
                    <div className="sidebar-site-name">{site.site_name}</div>
                    <div className="sidebar-site-url">{site.site_url}</div>
                  </div>
                  <div className={`sidebar-site-status ${site.status === 'paused' ? 'paused' : ''}`}
                    style={site.status === 'paused' ? { background: 'var(--color-warning)' } : {}}
                  />
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
            <button
              className="sidebar-add-site"
              onClick={() => setShowConnectModal(true)}
              id="add-site-btn"
            >
              + Connect Store
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
            ⚙️ Settings
          </button>
          <button className="btn btn-ghost" onClick={handleLogout}>
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* Connect Site Modal */}
      <ConnectSiteModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onSiteAdded={handleSiteAdded}
      />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => { setShowSettings(false); fetchSites(); }}
      />
    </>
  );
}
