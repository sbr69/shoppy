import { useState } from 'react';
import api from '../../services/api';
import { Storefront, Pencil, Plug } from '@phosphor-icons/react';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../common/ConfirmDialog';

export default function SiteCard({ site, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(site.spending_cap);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const toast = useToast();

  const handleSaveCap = async () => {
    try {
      setSaving(true);
      const { data } = await api.patch(`/sites/${site.id}`, { spendingCap: cap });
      onUpdate(data.site);
      setEditing(false);
    } catch (err) {
      console.error('Update error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    try {
      const newStatus = site.status === 'active' ? 'paused' : 'active';
      const { data } = await api.patch(`/sites/${site.id}`, { status: newStatus });
      onUpdate(data.site);
    } catch (err) {
      console.error('Toggle error:', err);
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      const { data } = await api.post(`/sites/${site.id}/disconnect`);
      onRemove(site.id);
      setConfirmingDisconnect(false);
      if (data.remoteRevoked === false || data.policyRevoked === false) {
        const detail = data.policyRevoked === false
          ? 'On-chain rule removal could not be confirmed; support should retry it.'
          : 'The store did not confirm remote token revocation.';
        toast.warning(`Store disconnected from JarvisPayz. ${detail}`);
      } else {
        toast.success(`${site.site_name} disconnected. The agent no longer has access.`);
      }
    } catch (err) {
      console.error('Disconnect error:', err);
      toast.error(err.response?.data?.error || 'Could not disconnect this store. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };


  return (
    <div className={`site-card glass-card ${site.status === 'paused' ? 'paused' : ''}`}>
      <div className="site-card-header">
        <div className="site-card-info">
          <div className="sidebar-site-favicon">
            <Storefront size={18} weight="duotone" />
          </div>
          <div>
            <div className="site-card-name">{site.site_name}</div>
            <div className="site-card-url">{site.site_url}</div>
          </div>
        </div>
        <div className="site-card-status-row">
          <button
            className={`site-status-toggle ${site.status}`}
            onClick={handleToggleStatus}
            title={site.status === 'active' ? 'Pause this store' : 'Activate this store'}
          >
            {site.status === 'active' ? '● Active' : '○ Paused'}
          </button>
        </div>
      </div>

      <div className="site-card-body">
        <div className="site-card-cap">
          <span className="form-label">Daily Spending Cap</span>
          {editing ? (
            <div className="site-cap-edit">
              <input
                type="number"
                className="form-input form-input-sm"
                value={cap}
                onChange={(e) => setCap(parseFloat(e.target.value) || 0)}
                min="0"
                step="100"
              />
              <span className="site-cap-unit">XLM</span>
              <button className="btn btn-primary btn-sm" onClick={handleSaveCap} disabled={saving}>
                {saving ? '...' : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setCap(site.spending_cap); }}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="site-cap-display" onClick={() => setEditing(true)}>
              <span className="site-cap-value">{site.spending_cap?.toLocaleString()} XLM</span>
              <span className="site-cap-edit-icon">
                <Pencil size={12} />
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="site-card-footer">
        <button
          className="btn btn-ghost site-remove-btn"
          onClick={() => setConfirmingDisconnect(true)}
          disabled={disconnecting}
        >
          {disconnecting ? (
            'Disconnecting...'
          ) : (
            <>
              <Plug size={14} />
              Disconnect
            </>
          )}
        </button>
      </div>
      <ConfirmDialog
        isOpen={confirmingDisconnect}
        title={`Disconnect ${site.site_name}?`}
        description="The agent will immediately lose access to this store. You can connect it again later."
        confirmLabel="Disconnect store"
        onConfirm={handleDisconnect}
        onClose={() => setConfirmingDisconnect(false)}
        busy={disconnecting}
      />
    </div>
  );
}
