import { useState, useEffect } from 'react';
import api from '../../services/api';
import { X } from '@phosphor-icons/react';

export default function SettingsPanel({ isOpen, onClose }) {
  const [profile, setProfile] = useState({ fullName: '', phone: '', line1: '', city: '', state: '', postalCode: '', country: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animateOut, setAnimateOut] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimateOut(false);
      api.get('/profile').then(({ data }) => setProfile((current) => ({ ...current, ...(data.profile || {}) }))).catch(() => {});
    } else if (shouldRender) {
      setAnimateOut(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimateOut(false);
      }, 280);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  if (!shouldRender) return null;

  return (
    <div className={`modal-overlay ${animateOut ? 'animate-out' : ''}`} onClick={onClose}>
      <div className={`settings-panel ${animateOut ? 'animate-out' : ''}`} onClick={(e) => e.stopPropagation()}>
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
        </div>
      </div>
    </div>
  );
}
