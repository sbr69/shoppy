import { useState } from 'react';
import { ArrowSquareOut, Check, Copy } from '@phosphor-icons/react';
import { useToast } from '../../contexts/ToastContext';

const truncateHash = (hash, compact) => compact
  ? `${hash.slice(0, 6)}…${hash.slice(-4)}`
  : `${hash.slice(0, 8)}…${hash.slice(-8)}`;

export default function TransactionHash({ hash, explorerUrl, className = '', compact = false }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (typeof hash !== 'string' || !hash) return null;

  const copyHash = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      toast.success('Transaction hash copied');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the transaction hash');
    }
  };

  return (
    <span className={`transaction-hash-control ${className}`.trim()}>
      {explorerUrl ? (
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="explorer-hash-link" aria-label="View transaction on Stellar Explorer">
          <code>{truncateHash(hash, compact)}</code>
          <ArrowSquareOut size={12} aria-hidden="true" />
        </a>
      ) : <code>{truncateHash(hash, compact)}</code>}
      <button type="button" className="copy-tx-button" onClick={copyHash} aria-label="Copy transaction hash" title="Copy transaction hash">
        {copied ? <Check size={13} weight="bold" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    </span>
  );
}
