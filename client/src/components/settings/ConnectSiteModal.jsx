import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { X } from '@phosphor-icons/react';

export default function ConnectSiteModal({ isOpen, onClose }) {
  const [siteUrl, setSiteUrl] = useState('');
  const [spendingCap, setSpendingCap] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const urlInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousFocus = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => urlInputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [isOpen, onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!siteUrl.trim()) {
      setError('Enter the URL of the store you want to authorize.');
      return;
    }

    try {
      setLoading(true);
      const { data } = await api.post('/sites/oauth/start', {
        siteUrl: siteUrl.trim(),
        spendingCap,
      });
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to connect site';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card glass-card" role="dialog" aria-modal="true" aria-labelledby="connect-store-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="connect-store-title">Connect a Store</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="site-url">Store URL</label>
            <input
              id="site-url"
              ref={urlInputRef}
              type="text"
              className="form-input"
              placeholder="https://mystore.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
            />
            <span className="form-hint">You will sign in on that store, then return here automatically.</span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="spending-cap">
              Daily Spending Cap (XLM)
            </label>
            <input
              id="spending-cap"
              type="number"
              className="form-input"
              placeholder="1000"
              value={spendingCap}
              onChange={(e) => setSpendingCap(parseFloat(e.target.value) || 0)}
              min="0"
              step="100"
            />
            <span className="form-hint">Maximum amount the agent can spend per day on this store</span>
          </div>

          <p className="form-hint">JarvisPayz never sees your store password. The store grants a limited OAuth connection for search and checkout.</p>

          {error && (
            <div className="form-error">{error}</div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              id="connect-site-submit"
            >
              {loading ? (
                <><span className="spinner" /> Connecting...</>
              ) : (
                'Connect'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
