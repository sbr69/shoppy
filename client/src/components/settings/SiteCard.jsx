import { useState } from 'react';
import api from '../../services/api';
import { Storefront, Pencil, Trash } from '@phosphor-icons/react';

export default function SiteCard({ site, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(site.spending_cap);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

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

  const handleRemove = async () => {
    if (!confirm(`Remove "${site.site_name}" from connected stores?`)) return;
    try {
      setRemoving(true);
      await api.delete(`/sites/${site.id}`);
      onRemove(site.id);
    } catch (err) {
      console.error('Remove error:', err);
    } finally {
      setRemoving(false);
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
          onClick={handleRemove}
          disabled={removing}
        >
          {removing ? (
            'Removing...'
          ) : (
            <>
              <Trash size={14} />
              Remove
            </>
          )}
        </button>
      </div>
    </div>
  );
}
