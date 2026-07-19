import { useEffect, useState } from 'react';
import { CheckCircle, Storefront, X } from '@phosphor-icons/react';
import SiteCard from './SiteCard';

export default function StoreDetailsModal({ site, onClose, onUpdated, onDisconnected }) {
  const [currentSite, setCurrentSite] = useState(site);
  const [shouldRender, setShouldRender] = useState(Boolean(site));
  const [animateOut, setAnimateOut] = useState(false);

  useEffect(() => {
    if (site) {
      setCurrentSite(site);
      setShouldRender(true);
      setAnimateOut(false);
    } else if (shouldRender) {
      setAnimateOut(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimateOut(false);
      }, 280);
      return () => clearTimeout(timer);
    }
  }, [site, shouldRender]);

  useEffect(() => {
    if (!shouldRender || animateOut) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shouldRender, animateOut, onClose]);

  if (!shouldRender || !currentSite) return null;

  return (
    <div className={`modal-overlay ${animateOut ? 'animate-out' : ''}`} onMouseDown={onClose}>
      <section className={`settings-panel store-details-modal ${animateOut ? 'animate-out' : ''}`} role="dialog" aria-modal="true" aria-labelledby="store-details-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-header store-details-header">
          <div className="store-details-identity">
            <span className="store-details-icon"><Storefront size={19} weight="duotone" /></span>
            <div>
              <p className="store-dialog-eyebrow">CONNECTED STOREFRONT</p>
              <h2 id="store-details-title">{currentSite.site_name}</h2>
              <p className="store-details-url">{currentSite.site_url}</p>
            </div>
          </div>
          <div className="store-details-header-actions">
            <span className={`store-connection-state ${currentSite.status === 'paused' ? 'is-paused' : ''}`}><CheckCircle size={13} weight="fill" />{currentSite.status === 'paused' ? 'Paused' : 'Authorized'}</span>
            <button className="modal-close" onClick={onClose} aria-label="Close store controls"><X size={16} /></button>
          </div>
        </header>
        <div className="settings-body store-details-body">
          <div className="store-details-notice">
            <CheckCircle size={16} weight="fill" />
            <p>Your store authorization is active. Spending rules update automatically when you change them and are verified again before payment.</p>
          </div>
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
