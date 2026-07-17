import { useState } from 'react';
import { Fingerprint, LockKeyOpen, ShieldCheck } from '@phosphor-icons/react';
import api from '../../services/api';
import { signPurchaseAuthorization } from '../../services/passkeyVault';

export default function ApprovalCard({ approval, product, historical = false, onComplete }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const summary = approval?.summary;

  const approve = async () => {
    try {
      setLoading(true);
      setError('');
      const { data: chain } = await api.get('/wallet/chain-config');
      const signedAuthorizationEntryXdr = await signPurchaseAuthorization(approval, chain.networkPassphrase);
      const { data } = await api.post(`/purchases/approvals/${approval.approvalId}/authorize`, { signedAuthorizationEntryXdr });
      onComplete(data.purchase);
    } catch (approvalError) {
      setError(approvalError.response?.data?.error || approvalError.message || 'Could not authorize this purchase');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="receipt-card" style={{ marginLeft: 44, marginTop: 8 }}>
      <div className="receipt-card-header"><ShieldCheck size={18} weight="fill" /> Exact passkey approval required</div>
      <div className="receipt-card-row"><span className="receipt-card-label">Item</span><span className="receipt-card-value">{product?.name || summary?.product?.name}</span></div>
      <div className="receipt-card-row"><span className="receipt-card-label">Merchant</span><span className="receipt-card-value">{summary?.merchant?.siteName}</span></div>
      <div className="receipt-card-row"><span className="receipt-card-label">Order</span><span className="receipt-card-value">{summary?.merchant?.orderId}</span></div>
      <div className="receipt-card-row"><span className="receipt-card-label">Amount</span><span className="receipt-card-value receipt-card-value--xlm">{Number(summary?.amountXlm || 0).toFixed(7)} XLM</span></div>
      <div className="receipt-card-footer">
        <button className="btn btn-primary" onClick={approve} disabled={loading || historical || !approval?.authorizationEntryXdr} id="approve-purchase-btn">
          {loading ? <><span className="spinner" /> Waiting for passkey...</> : <><Fingerprint size={15} weight="bold" /> Approve exact payment</>}
        </button>
      </div>
      <div className="form-hint" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}><LockKeyOpen size={14} /> The server can submit only this passkey-authorized SpendGuard transaction.</div>
      {historical && <div className="form-hint" style={{ marginTop: 6 }}>This previous approval is no longer actionable.</div>}
      {error && <div className="form-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
