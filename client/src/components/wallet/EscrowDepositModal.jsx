import { useState } from 'react';
import { Coins, X } from '@phosphor-icons/react';
import { submitPasskeyOwnerAction } from '../../services/passkeyVault';

export default function EscrowDepositModal({ isOpen, onClose, onComplete }) {
  const [amountXlm, setAmountXlm] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const deposit = async (event) => {
    event.preventDefault();
    const amount = Number(amountXlm);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a positive XLM amount.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const result = await submitPasskeyOwnerAction({ actionType: 'deposit', amountXlm: amount });
      await onComplete(result);
      onClose();
    } catch (depositError) {
      setError(depositError.response?.data?.error || depositError.message || 'Could not deposit to SpendGuard');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !loading && onClose()}>
      <form className="modal-card glass-card" onSubmit={deposit} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><h3><Coins size={18} weight="duotone" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />Deposit to SpendGuard</h3><button type="button" className="modal-close" onClick={onClose} disabled={loading} aria-label="Close"><X size={16} /></button></div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="escrow-amount">Test XLM amount</label>
            <input id="escrow-amount" className="form-input" type="number" min="0.0000001" step="0.0000001" value={amountXlm} onChange={(event) => setAmountXlm(event.target.value)} autoFocus />
            <span className="form-hint">Your passkey signs this exact transfer into the contract escrow. The agent cannot withdraw it.</span>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button><button className="btn btn-primary" disabled={loading}>{loading ? <><span className="spinner" /> Waiting for passkey...</> : 'Deposit exact amount'}</button></div>
        </div>
      </form>
    </div>
  );
}
