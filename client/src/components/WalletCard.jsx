import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

export default function WalletCard() {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const fetchWallet = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/wallet');
      setWallet(data);
      setError(null);
    } catch (err) {
      setError('Failed to load wallet');
      console.error('Wallet fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  const handleFund = async () => {
    try {
      setFunding(true);
      await api.post('/wallet/fund');
      // Refresh balance after funding
      await fetchWallet();
    } catch (err) {
      setError('Failed to fund wallet');
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

  const truncateAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
  };

  if (loading) {
    return (
      <div className="wallet-card glass-card">
        <div className="wallet-card-header">
          <div className="wallet-card-title">
            <span className="wallet-icon">💳</span>
            <h3>Stellar Wallet</h3>
          </div>
        </div>
        <div className="wallet-card-body">
          <div className="wallet-skeleton">
            <div className="skeleton-line skeleton-lg" />
            <div className="skeleton-line skeleton-sm" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-card glass-card">
      <div className="wallet-card-header">
        <div className="wallet-card-title">
          <span className="wallet-icon">💳</span>
          <h3>Stellar Wallet</h3>
        </div>
        <span className={`wallet-status ${wallet?.funded ? 'funded' : 'unfunded'}`}>
          {wallet?.funded ? '● Active' : '○ Unfunded'}
        </span>
      </div>

      <div className="wallet-card-body">
        {/* Balance */}
        <div className="wallet-balance">
          <span className="wallet-balance-label">Balance</span>
          <span className="wallet-balance-value">
            {parseFloat(wallet?.balance || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <span className="wallet-balance-unit">XLM</span>
          </span>
        </div>

        {/* Address */}
        <div className="wallet-address" onClick={handleCopy} title="Click to copy">
          <span className="wallet-address-label">Address</span>
          <div className="wallet-address-row">
            <code className="wallet-address-value">{truncateAddress(wallet?.publicKey)}</code>
            <span className="wallet-copy-icon">{copied ? '✓' : '📋'}</span>
          </div>
        </div>

        {/* Network Badge */}
        <div className="wallet-network">
          <span className="badge">Stellar Testnet</span>
        </div>

        {/* Error */}
        {error && (
          <div className="wallet-error">
            {error}
          </div>
        )}
      </div>

      <div className="wallet-card-footer">
        <button
          className="btn btn-primary wallet-fund-btn"
          onClick={handleFund}
          disabled={funding}
          id="fund-wallet-btn"
        >
          {funding ? (
            <>
              <span className="spinner" />
              Funding...
            </>
          ) : (
            <>☄️ Fund with Friendbot</>
          )}
        </button>
        <a
          href={wallet?.publicKey ? `https://stellar.expert/explorer/testnet/contract/${wallet.publicKey}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost wallet-explorer-btn"
          id="view-explorer-btn"
        >
          View on Explorer ↗
        </a>
      </div>
    </div>
  );
}
