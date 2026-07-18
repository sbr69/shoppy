import { Warning } from '@phosphor-icons/react';

export default function ConfirmDialog({ isOpen, title, description, confirmLabel = 'Confirm', onConfirm, onClose, busy = false }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay confirm-dialog-overlay" onMouseDown={onClose}>
      <section className="modal-card confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
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
