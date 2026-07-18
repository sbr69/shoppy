import { useState, useEffect } from 'react';
import api from '../../services/api';
import ConnectSiteModal from './ConnectSiteModal';
import SiteCard from './SiteCard';
import { X, PlusCircle, LinkSimple } from '@phosphor-icons/react';

export default function SettingsPanel({ isOpen, onClose }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [profile, setProfile] = useState({ fullName: '', phone: '', line1: '', city: '', state: '', postalCode: '', country: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (isOpen) { fetchSites(); api.get('/profile').then(({ data }) => setProfile((current) => ({ ...current, ...(data.profile || {}) }))).catch(() => {}); }
  }, [isOpen]);

  const fetchSites = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/sites');
      setSites(data.sites || []);
    } catch (err) {
      console.error('Sites error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSiteAdded = (site) => {
    setSites(prev => [site, ...prev]);
  };

  const handleSiteUpdated = (updatedSite) => {
    setSites(prev => prev.map(s => s.id === updatedSite.id ? { ...s, ...updatedSite } : s));
  };

  const handleSiteRemoved = (siteId) => {
    setSites(prev => prev.filter(s => s.id !== siteId));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-section-header"><h3>Personal details</h3></div>
            <p className="form-hint">Saved securely and shared only with a store when you approve a delivery checkout.</p>
            <div className="settings-profile-grid">
              {[['fullName', 'Full name'], ['phone', 'Phone'], ['line1', 'Address'], ['city', 'City'], ['state', 'State'], ['postalCode', 'PIN / postal code'], ['country', 'Country']].map(([key, label]) => <label className="form-group" key={key}><span className="form-label">{label}</span><input className="form-input" value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} /></label>)}
            </div>
            <button className="btn btn-primary btn-sm" disabled={savingProfile} onClick={async () => { setSavingProfile(true); try { await api.put('/profile', profile); } finally { setSavingProfile(false); } }}>{savingProfile ? 'Saving…' : 'Save personal details'}</button>
          </div>
          {/* Connected Sites Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <h3>Connected Stores</h3>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowModal(true)}
                id="settings-add-site"
              >
                <PlusCircle size={14} weight="bold" />
                Connect Store
              </button>
            </div>

            {loading ? (
              <div className="settings-loading">
                <div className="spinner-lg" />
              </div>
            ) : sites.length === 0 ? (
              <div className="settings-empty">
                <p>No stores connected yet.</p>
                <p>Connect an e-commerce site to let the agent shop for you.</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowModal(true)}
                >
                  <LinkSimple size={14} weight="bold" />
                  Connect Your First Store
                </button>
              </div>
            ) : (
              <div className="settings-sites-grid">
                {sites.map(site => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    onUpdate={handleSiteUpdated}
                    onRemove={handleSiteRemoved}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <ConnectSiteModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSiteAdded={handleSiteAdded}
        />
      </div>
    </div>
  );
}
