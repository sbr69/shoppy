import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import SettingsPanel from '../settings/SettingsPanel';
import {
  Lightning,
  Wallet,
  Coins,
  Storefront,
  PlusCircle,
  Gear,
  SignOut,
  ArrowSquareOut,
  Copy,
  Check,
  ChatCircleText,
  ShoppingBag,
  ClockCounterClockwise,
  ShieldCheck,
} from '@phosphor-icons/react';

export default function Sidebar({ isOpen, onClose, activeView = 'chat', onNavigate, onNewChat, activeSessionId, onSessionSelect, onConnectStore, storeRefreshKey, walletRefreshKey }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [sessions, setSessions] = useState([]);

  const fetchWallet = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setWalletLoading(true);
      const { data } = await api.get('/wallet');
      setWallet(data);
    } catch {
      if (!silent) toast.error('Failed to load wallet');
    } finally {
      if (!silent) setWalletLoading(false);
    }
  }, [toast]);

  const fetchSites = useCallback(async () => {
    try {
      setSitesLoading(true);
      const { data } = await api.get('/sites');
      setSites(data.sites || []);
    } catch {
      setSites([]);
    } finally {
      setSitesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallet();
    fetchSites();
    api.get('/chat/sessions').then(({ data }) => setSessions(data.sessions || [])).catch(() => setSessions([]));
  }, [fetchWallet, fetchSites, activeSessionId, storeRefreshKey, walletRefreshKey]);

  // Immediate refreshes cover in-app funding/purchases; this short, silent
  // poll also reflects an on-chain balance change made outside this browser.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void fetchWallet({ silent: true });
    };
    const interval = window.setInterval(refreshIfVisible, 12_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [fetchWallet]);

  const selectSession = (id) => onSessionSelect?.(id);

  const handleFund = async () => {
    try {
      setFunding(true);
      const { data } = await api.post('/wallet/fund');
      await fetchWallet();
      if (data.alreadyFunded) {
        toast.info('Wallet already funded');
      } else {
        const fundedAmount = data.smartWallet?.fundedAmountXlm;
        toast.success(`Agent wallet funded with ${fundedAmount || 'test'} XLM!`);
      }
    } catch {
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
          <div className="navbar-logo" onClick={() => { onClose(); navigate('/'); }} style={{ cursor: 'pointer' }}>
            <div className="navbar-logo-icon">
              <Lightning size={16} weight="fill" />
            </div>
            <span>JarvisPayz</span>
          </div>
          <button className="sidebar-user-btn" title={user?.email}>
            {user?.avatarUrl && (
              <img src={user.avatarUrl} alt={user.name} referrerPolicy="no-referrer" />
            )}
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace">
          <button className={activeView === 'chat' ? 'active' : ''} onClick={() => onNavigate?.('chat')}><ChatCircleText size={17} /> Shop assistant</button>
          <button className={activeView === 'orders' ? 'active' : ''} onClick={() => onNavigate?.('orders')}><ShoppingBag size={17} /> Orders</button>
          <button className={activeView === 'wallet' ? 'active' : ''} onClick={() => onNavigate?.('wallet')}><ClockCounterClockwise size={17} /> Wallet activity</button>
          <button className={activeView === 'stores' ? 'active' : ''} onClick={() => onNavigate?.('stores')}><ShieldCheck size={17} /> Stores & safeguards</button>
        </nav>

        <div className="sidebar-history">
          <div className="sidebar-history-head"><span>Chat history</span><button onClick={onNewChat} title="New chat"><PlusCircle size={16} /></button></div>
          <button className="sidebar-new-chat" onClick={onNewChat}><PlusCircle size={15} /> New chat</button>
          {sessions.slice(0, 8).map((session) => <button className={`sidebar-session ${activeSessionId === session.id ? 'active' : ''}`} key={session.id} onClick={() => selectSession(session.id)}>{session.title || 'New shopping chat'}</button>)}
        </div>

        {/* Wallet */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <Wallet size={14} weight="bold" style={{ marginRight: 6 }} /> Wallet
          </div>
          {walletLoading ? (
            <div className="sidebar-wallet">
              <div className="skeleton-line skeleton-lg" style={{ marginBottom: 8 }} />
              <div className="skeleton-line skeleton-sm" />
            </div>
          ) : (
            <div className="sidebar-wallet">
              <>
                <div className="sidebar-wallet-balance">
                  <span className="sidebar-wallet-amount">{wallet?.funded ? parseFloat(wallet.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</span>
                  <span className="sidebar-wallet-unit">XLM</span>
                </div>
                <div className="sidebar-wallet-address" onClick={handleCopy} title="Click to copy full address">
                  {copied ? <span className="copied-text"><Check size={12} weight="bold" /> Copied!</span> : <><span>{truncateAddr(wallet?.publicKey)}</span><Copy size={12} /></>}
                </div>
                <div className="sidebar-wallet-actions">
                  <button className="btn btn-primary" onClick={handleFund} disabled={funding}>
                    {funding ? <><span className="spinner" /> Funding...</> : <><Coins size={14} weight="bold" /> Fund</>}
                  </button>
                  <a href={wallet?.publicKey ? `https://stellar.expert/explorer/testnet/contract/${wallet.publicKey}` : '#'} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Explorer<ArrowSquareOut size={14} /></a>
                </div>
              </>
            </div>
          )}
        </div>

        {/* Connected Sites */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <Storefront size={14} weight="bold" style={{ marginRight: 6 }} /> Connected Stores ({sites.length})
          </div>
          <div className="sidebar-sites-list">
            {sitesLoading ? (
              <>
                <div className="skeleton-line" style={{ height: 48, borderRadius: 8 }} />
                <div className="skeleton-line" style={{ height: 48, borderRadius: 8 }} />
              </>
            ) : sites.length > 0 ? (
              sites.map((site) => (
                <div key={site.id} className="sidebar-site-item">
                  <div className="sidebar-site-favicon">
                    <Storefront size={16} weight="duotone" />
                  </div>
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
              onClick={onConnectStore}
              id="add-site-btn"
            >
              <PlusCircle size={14} weight="bold" />
              Connect Store
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
            <Gear size={14} />
            Settings
          </button>
          <button className="btn btn-ghost" onClick={handleLogout}>
            <SignOut size={14} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => { setShowSettings(false); fetchSites(); }}
      />
    </>
  );
}
