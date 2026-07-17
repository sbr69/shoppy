import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import ConnectSiteModal from '../settings/ConnectSiteModal';
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
  Fingerprint,
} from '@phosphor-icons/react';
import PasskeyVaultModal from '../wallet/PasskeyVaultModal';
import EscrowDepositModal from '../wallet/EscrowDepositModal';
import { submitPasskeyOwnerAction } from '../../services/passkeyVault';

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
  const [showVaultSetup, setShowVaultSetup] = useState(false);
  const [configuringAgent, setConfiguringAgent] = useState(false);
  const [showEscrowDeposit, setShowEscrowDeposit] = useState(false);

  const fetchWallet = useCallback(async () => {
    try {
      setWalletLoading(true);
      const { data } = await api.get('/wallet');
      setWallet(data);
    } catch {
      toast.error('Failed to load wallet');
    } finally {
      setWalletLoading(false);
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
  }, [fetchWallet, fetchSites]);

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

  const handleSiteAdded = (site) => {
    setSites(prev => [site, ...prev]);
  };

  const handleVaultComplete = async () => {
    await fetchWallet();
    toast.success('Passkey vault created. Fund it with Friendbot to begin testnet testing.');
  };

  const handleConfigureAgent = async () => {
    try {
      setConfiguringAgent(true);
      await submitPasskeyOwnerAction({ actionType: 'set_agent' });
      toast.success('Agent signer authorized on SpendGuard. Sync each connected store rule next.');
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || 'Could not authorize agent signer');
    } finally {
      setConfiguringAgent(false);
    }
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
              {wallet?.vaultSetupRequired ? (
                <>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>Create your browser-held Stellar wallet with a synced passkey.</div>
                  <button className="btn btn-primary" onClick={() => setShowVaultSetup(true)} id="sidebar-setup-passkey-btn"><Fingerprint size={14} weight="bold" /> Set up vault</button>
                </>
              ) : <>
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
                  <a href={wallet?.publicKey ? `https://stellar.expert/explorer/testnet/account/${wallet.publicKey}` : '#'} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Explorer<ArrowSquareOut size={14} /></a>
                </div>
                <button className="btn btn-ghost" onClick={handleConfigureAgent} disabled={configuringAgent || !wallet?.funded} style={{ marginTop: 8, width: '100%', fontSize: 'var(--text-xs)' }} title={wallet?.funded ? 'Passkey-sign the constrained agent on SpendGuard' : 'Fund the testnet wallet first'}>
                  {configuringAgent ? <><span className="spinner" /> Authorizing agent...</> : 'Authorize constrained agent'}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowEscrowDeposit(true)} disabled={!wallet?.funded} style={{ marginTop: 6, width: '100%', fontSize: 'var(--text-xs)' }} title={wallet?.funded ? 'Passkey-sign a test XLM deposit to SpendGuard' : 'Fund the testnet wallet first'}>Deposit to SpendGuard</button>
              </>}
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
              onClick={() => setShowConnectModal(true)}
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
      <PasskeyVaultModal isOpen={showVaultSetup} onClose={() => setShowVaultSetup(false)} onComplete={handleVaultComplete} />
      <EscrowDepositModal isOpen={showEscrowDeposit} onClose={() => setShowEscrowDeposit(false)} onComplete={(result) => toast.success(`SpendGuard deposit submitted: ${result.txHash.slice(0, 10)}…`)} />
    </>
  );
}
