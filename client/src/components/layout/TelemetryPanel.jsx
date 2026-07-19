import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import { captureClientException, trackProductEvent } from '../../services/observability';
import {
  Wallet,
  Coins,
  ArrowSquareOut,
  Copy,
  Check,
  Storefront,
  PlusCircle,
  ShieldCheck,
  X,
} from '@phosphor-icons/react';

const walletCacheKey = (userId) => `jarvispayz_wallet_snapshot_${userId}`;
const readWalletSnapshot = (userId) => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(walletCacheKey(userId)) || 'null');
    return saved?.expiresAt > Date.now() ? saved.wallet : null;
  } catch { return null; }
};
const saveWalletSnapshot = (userId, wallet) => {
  try { sessionStorage.setItem(walletCacheKey(userId), JSON.stringify({ wallet, expiresAt: Date.now() + 60_000 })); } catch { /* Storage is an optional enhancement. */ }
};

export default function TelemetryPanel({ isOpen, onClose, onConnectStore, onStoreSelect, storeRefreshKey, walletRefreshKey, onWalletChanged, initialSites, bootstrapLoading = false }) {
  const toast = useToast();
  const { user } = useAuth();
  const [wallet, setWallet] = useState(() => readWalletSnapshot(user?.id));
  const [walletLoading, setWalletLoading] = useState(() => !readWalletSnapshot(user?.id));
  const [funding, setFunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sites, setSites] = useState(initialSites || []);
  const [sitesLoading, setSitesLoading] = useState(!Array.isArray(initialSites));

  const fetchWallet = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setWalletLoading(true);
      const { data } = await api.get('/wallet');
      setWallet(data);
      if (user?.id) saveWalletSnapshot(user.id, data);
    } catch {
      if (!silent) toast.error('Failed to load wallet');
    } finally {
      if (!silent) setWalletLoading(false);
    }
  }, [toast, user?.id]);

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
  }, [fetchWallet, walletRefreshKey]);

  useEffect(() => {
    if (bootstrapLoading) return;
    if (Array.isArray(initialSites) && storeRefreshKey === 0) {
      setSites(initialSites);
      setSitesLoading(false);
      return;
    }
    fetchSites();
  }, [bootstrapLoading, fetchSites, initialSites, storeRefreshKey]);

  // Silent poll for balance updates
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

  const handleFund = async () => {
    try {
      setFunding(true);
      trackProductEvent('wallet_funding_requested');
      const { data } = await api.post('/wallet/fund');
      await fetchWallet();
      if (data.alreadyFunded) {
        trackProductEvent('wallet_funding_already_available');
        toast.info('Wallet already funded');
      } else {
        trackProductEvent('wallet_funding_completed');
        const fundedAmount = data.smartWallet?.fundedAmountXlm;
        toast.success(`Agent wallet funded with ${fundedAmount || 'test'} XLM!`);
        onWalletChanged?.();
      }
    } catch (error) {
      captureClientException(error, { feature: 'wallet_funding', status: error.response?.status || 0 });
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

  return (
    <>
      <div
        className={`telemetry-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />
      <aside className={`telemetry-panel ${isOpen ? '' : 'closed'}`}>
        <div className="telemetry-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={18} weight="fill" color="var(--color-accent)" />
            <h2>Agent Telemetry</h2>
          </div>
          <button
            className="telemetry-close-btn"
            onClick={onClose}
            aria-label="Close panel"
            title="Close panel"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

      <div className="telemetry-body">
        {/* Wallet Section */}
        <section className="telemetry-section">
          <div className="telemetry-section-title">
            <Wallet size={14} weight="bold" />
            <span>Smart Wallet</span>
          </div>

          {walletLoading ? (
            <div className="telemetry-wallet-skeleton">
              <span className="wallet-skeleton-label" />
              <span className="wallet-skeleton-balance" />
              <span className="wallet-skeleton-address" />
              <div className="wallet-skeleton-actions"><span /><span /></div>
            </div>
          ) : (
            <div className="telemetry-wallet-card">
              <div className="telemetry-wallet-balance">
                <span className="telemetry-wallet-amount">
                  {wallet?.funded
                    ? parseFloat(wallet.balance).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                    : '0.00'}
                </span>
                <span className="telemetry-wallet-unit">XLM</span>
              </div>

              <div className="telemetry-wallet-address" onClick={handleCopy} title="Copy Stellar address">
                {copied ? (
                  <span className="copied-text">
                    <Check size={12} weight="bold" /> Copied!
                  </span>
                ) : (
                  <>
                    <span>{truncateAddr(wallet?.publicKey)}</span>
                    <Copy size={12} />
                  </>
                )}
              </div>

              <div className="telemetry-wallet-actions">
                <button className="btn btn-primary" onClick={handleFund} disabled={funding}>
                  {funding ? (
                    'Funding…'
                  ) : (
                    <>
                      <Coins size={14} weight="bold" /> Fund
                    </>
                  )}
                </button>
                <a
                  href={wallet?.publicKey ? `https://stellar.expert/explorer/testnet/contract/${wallet.publicKey}` : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                >
                  <span>Explorer</span>
                  <ArrowSquareOut size={13} />
                </a>
              </div>
            </div>
          )}
        </section>

        {/* Connected Stores Section */}
        <section className="telemetry-section">
          <div className="telemetry-section-title">
            <Storefront size={14} weight="bold" />
            <span>Connected Stores ({sites.length})</span>
          </div>

          <div className="telemetry-sites-list">
            {sitesLoading ? (
              <div className="telemetry-sites-skeleton">
                <div className="skeleton-line" style={{ height: 48, borderRadius: 8, marginBottom: 8 }} />
                <div className="skeleton-line" style={{ height: 48, borderRadius: 8 }} />
              </div>
            ) : sites.length > 0 ? (
              <div className="telemetry-sites-grid">
                {sites.map((site) => (
                  <button key={site.id} className="telemetry-site-item telemetry-site-item--button" onClick={() => onStoreSelect?.(site)} aria-label={`Manage ${site.site_name}`}>
                    <div className="telemetry-site-favicon">
                      <Storefront size={16} weight="duotone" />
                    </div>
                    <div className="telemetry-site-info">
                      <div className="telemetry-site-name">{site.site_name}</div>
                      <div className="telemetry-site-url">{site.site_url}</div>
                      <div className="telemetry-site-limits">
                        <span>Limit: {parseFloat(site.per_transaction_cap).toFixed(0)} XLM/order</span>
                      </div>
                    </div>
                    <div className={`telemetry-site-status ${site.status === 'paused' ? 'paused' : ''}`} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="telemetry-empty-state">No active store channels</div>
            )}

            <button className="telemetry-add-site-btn" onClick={onConnectStore} id="telemetry-add-site">
              <PlusCircle size={14} weight="bold" />
              <span>Connect Store</span>
            </button>
          </div>
        </section>

      </div>
    </aside>
  </>
  );
}
