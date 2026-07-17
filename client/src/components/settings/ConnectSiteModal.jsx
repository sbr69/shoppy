import { useState } from 'react';
import api from '../../services/api';
import { LinkSimple, X } from '@phosphor-icons/react';

export default function ConnectSiteModal({ isOpen, onClose, onSiteAdded }) {
  const [siteUrl, setSiteUrl] = useState('');
  const [spendingCap, setSpendingCap] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!siteUrl.trim()) {
      setError('Please enter the registered store URL.');
      return;
    }

    try {
      setLoading(true);
      const { data } = await api.post('/sites', {
        siteUrl: siteUrl.trim(),
        spendingCap,
      });
      onSiteAdded(data.site);
      setSiteUrl('');
      setSpendingCap(1000);
      onClose();
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
      <div className="modal-card glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Connect a Store</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="site-url">Store URL</label>
            <input
              id="site-url"
              type="text"
              className="form-input"
              placeholder="https://mystore.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              autoFocus
            />
            <span className="form-hint">The e-commerce website URL to connect</span>
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

          <p className="form-hint">Every exact checkout requires a fresh passkey approval. Spending caps limit the contract policy; they never enable automatic payment.</p>

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
                <>
                  <LinkSimple size={14} weight="bold" />
                  Connect Store
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
