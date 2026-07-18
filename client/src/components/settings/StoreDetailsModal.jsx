import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import SiteCard from './SiteCard';

export default function StoreDetailsModal({ site, onClose, onUpdated, onDisconnected }) {
  const [currentSite, setCurrentSite] = useState(site);

  useEffect(() => setCurrentSite(site), [site]);
  useEffect(() => {
    if (!site) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [site, onClose]);

  if (!currentSite) return null;
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <section className="settings-panel store-details-modal" role="dialog" aria-modal="true" aria-labelledby="store-details-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-header">
          <div>
            <p className="store-dialog-eyebrow">AUTHORIZED STOREFRONT</p>
            <h2 id="store-details-title">{currentSite.site_name}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close store controls"><X size={16} /></button>
        </header>
        <div className="settings-body">
          <p className="form-hint">Limits and access controls are managed here. Safeguards synchronize automatically whenever they change, and again before a payment if needed.</p>
          <SiteCard
            site={currentSite}
            onUpdate={(updated) => { setCurrentSite(updated); onUpdated?.(updated); }}
            onRemove={(siteId) => onDisconnected?.(siteId)}
          />
        </div>
      </section>
    </div>
  );
}
