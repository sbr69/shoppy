import { useState } from 'react';
import { Fingerprint, LockKeyOpen, X } from '@phosphor-icons/react';
import { setupPasskeyVault } from '../../services/passkeyVault';

export default function PasskeyVaultModal({ isOpen, onClose, onComplete }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const setup = async () => {
    try {
      setLoading(true);
      setError('');
      const wallet = await setupPasskeyVault();
      await onComplete(wallet);
      onClose();
    } catch (setupError) {
      setError(setupError.response?.data?.error || setupError.message || 'Passkey vault setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !loading && onClose()}>
      <div className="modal-card glass-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3><Fingerprint size={18} weight="duotone" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />Create your passkey vault</h3>
          <button className="modal-close" onClick={onClose} disabled={loading} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="form-hint" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
            Your browser creates the Stellar owner key and encrypts it with a synced passkey. JarvisPayz receives only encrypted ciphertext and can never recover or sign with that key.
          </p>
          <div className="form-hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <LockKeyOpen size={16} /> You will verify your passkey twice: once to create it and once to seal the local wallet.
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Not now</button>
            <button type="button" className="btn btn-primary" onClick={setup} disabled={loading} id="setup-passkey-vault-btn">
              {loading ? <><span className="spinner" /> Creating vault...</> : <><Fingerprint size={15} weight="bold" /> Create with passkey</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
