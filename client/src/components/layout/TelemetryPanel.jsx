import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import {
  Wallet,
  Coins,
  ArrowSquareOut,
  Copy,
  Check,
  Storefront,
  PlusCircle,
  ShieldCheck,
} from '@phosphor-icons/react';

export default function TelemetryPanel({ isOpen, onConnectStore, storeRefreshKey, walletRefreshKey, onWalletChanged }) {
  const toast = useToast();
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(true);

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
  }, [fetchWallet, fetchSites, storeRefreshKey, walletRefreshKey]);

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
      const { data } = await api.post('/wallet/fund');
      await fetchWallet();
      if (data.alreadyFunded) {
        toast.info('Wallet already funded');
      } else {
        const fundedAmount = data.smartWallet?.fundedAmountXlm;
        toast.success(`Agent wallet funded with ${fundedAmount || 'test'} XLM!`);
        onWalletChanged?.();
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

  return (
    <aside className={`telemetry-panel ${isOpen ? '' : 'closed'}`}>
      <div className="telemetry-header">
        <ShieldCheck size={18} weight="fill" color="var(--color-accent)" />
        <h2>Agent Telemetry</h2>
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
              <div className="skeleton-line skeleton-lg" style={{ marginBottom: 8 }} />
              <div className="skeleton-line skeleton-sm" />
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
                    <>
                      <span className="spinner" /> Funding...
                    </>
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
                  <div key={site.id} className="telemetry-site-item">
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
                  </div>
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

        {/* Policy Safeguards info */}
        <section className="telemetry-section telemetry-safeguards-info">
          <div className="telemetry-section-title">
            <ShieldCheck size={14} weight="bold" />
            <span>On-chain Safeguards</span>
          </div>
          <p>
            Your spending policies and API connection authorizations are enforced directly by smart contracts on the
            Stellar testnet.
          </p>
        </section>
      </div>
    </aside>
  );
}
