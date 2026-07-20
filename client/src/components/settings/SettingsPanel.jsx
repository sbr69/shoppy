import { useState, useEffect } from 'react';
import api from '../../services/api';
import { X, User, MapPin, Gear, FloppyDisk, Flask } from '@phosphor-icons/react';
import { useToast } from '../../contexts/ToastContext';

const TEST_DELIVERY_PROFILE = {
  fullName: 'Test Shopper',
  phone: '+1 555 010 2048',
  line1: '123 Test Market Lane',
  city: 'Testville',
  state: 'CA',
  postalCode: '94105',
  country: 'United States',
};

export default function SettingsPanel({ isOpen, onClose }) {
  const toast = useToast();
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

  const handleChange = (key, value) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const fillTestDeliveryDetails = async () => {
    setSavingProfile(true);
    try {
      const { data } = await api.put('/profile', TEST_DELIVERY_PROFILE);
      setProfile((current) => ({ ...current, ...(data.profile || TEST_DELIVERY_PROFILE) }));
      toast.success('Test delivery details saved.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not save test delivery details.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className={`modal-overlay ${animateOut ? 'animate-out' : ''}`} onClick={onClose}>
      <div className={`settings-panel ${animateOut ? 'animate-out' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-handle" />
        
        {/* Modal Header */}
        <div className="settings-header">
          <div className="settings-header-title">
            <Gear size={20} weight="fill" color="var(--color-accent)" />
            <h2>Account Settings</h2>
          </div>

          <button className="modal-close" onClick={onClose} aria-label="Close settings">
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="settings-body">
          {/* Personal Info Group */}
          <div className="settings-group-card">
            <div className="settings-group-title">
              <User size={16} weight="bold" />
              <span>Personal Information</span>
            </div>
            
            <div className="settings-field-row">
              <label className="form-group">
                <span className="form-label">Full Name</span>
                <input
                  className="form-input"
                  placeholder="John Doe"
                  value={profile.fullName || ''}
                  onChange={(e) => handleChange('fullName', e.target.value)}
                />
              </label>

              <label className="form-group">
                <span className="form-label">Phone Number</span>
                <input
                  className="form-input"
                  placeholder="+1 (555) 000-0000"
                  value={profile.phone || ''}
                  onChange={(e) => handleChange('phone', e.target.value)}
                />
              </label>
            </div>
          </div>

          {/* Shipping Address Group */}
          <div className="settings-group-card">
            <div className="settings-group-title">
              <MapPin size={16} weight="bold" />
              <span>Shipping Address</span>
            </div>
            <p className="form-hint" style={{ marginBottom: 12 }}>
              Used automatically during authorized express checkout orders.
            </p>
            <div className="settings-test-profile">
              <div>
                <strong>Testing on Stellar testnet?</strong>
                <span>Save a safe placeholder delivery address for TestMarket orders.</span>
              </div>
              <button type="button" className="btn btn-secondary settings-test-profile-button" onClick={fillTestDeliveryDetails} disabled={savingProfile}>
                <Flask size={15} weight="bold" />
                Use test details
              </button>
            </div>

            <label className="form-group">
              <span className="form-label">Street Address</span>
              <input
                className="form-input"
                placeholder="123 Market Street, Suite 400"
                value={profile.line1 || ''}
                onChange={(e) => handleChange('line1', e.target.value)}
              />
            </label>

            <div className="settings-field-row">
              <label className="form-group">
                <span className="form-label">City</span>
                <input
                  className="form-input"
                  placeholder="San Francisco"
                  value={profile.city || ''}
                  onChange={(e) => handleChange('city', e.target.value)}
                />
              </label>

              <label className="form-group">
                <span className="form-label">State / Region</span>
                <input
                  className="form-input"
                  placeholder="CA"
                  value={profile.state || ''}
                  onChange={(e) => handleChange('state', e.target.value)}
                />
              </label>
            </div>

            <div className="settings-field-row">
              <label className="form-group">
                <span className="form-label">Postal / ZIP Code</span>
                <input
                  className="form-input"
                  placeholder="94105"
                  value={profile.postalCode || ''}
                  onChange={(e) => handleChange('postalCode', e.target.value)}
                />
              </label>

              <label className="form-group">
                <span className="form-label">Country</span>
                <input
                  className="form-input"
                  placeholder="United States"
                  value={profile.country || ''}
                  onChange={(e) => handleChange('country', e.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="settings-footer">
          <button
            className="btn btn-primary settings-save-btn"
            disabled={savingProfile}
            onClick={async () => {
              setSavingProfile(true);
              try {
                await api.put('/profile', profile);
              } finally {
                setSavingProfile(false);
              }
            }}
          >
            <FloppyDisk size={16} weight="bold" />
            <span>{savingProfile ? 'Saving Changes…' : 'Save Settings'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
