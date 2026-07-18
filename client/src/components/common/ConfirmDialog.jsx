import { useState, useEffect } from 'react';
import { Warning } from '@phosphor-icons/react';

export default function ConfirmDialog({ isOpen, title, description, confirmLabel = 'Confirm', onConfirm, onClose, busy = false }) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animateOut, setAnimateOut] = useState(false);

  useEffect(() => {
    if (isOpen) {
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
  }, [isOpen, shouldRender]);

  if (!shouldRender) return null;

  return (
    <div className={`modal-overlay confirm-dialog-overlay ${animateOut ? 'animate-out' : ''}`} onMouseDown={onClose}>
      <section className={`modal-card confirm-dialog ${animateOut ? 'animate-out' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-dialog-icon"><Warning size={20} weight="fill" /></div>
        <div>
          <h3 id="confirm-dialog-title">{title}</h3>
          <p>{description}</p>
        </div>
        <div className="modal-actions confirm-dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
