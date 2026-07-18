import { CheckCircle, ShoppingBag, ArrowSquareOut } from '@phosphor-icons/react';

export default function ReceiptCard({ product, purchase }) {
  const explorerUrl = purchase?.explorerUrl || (purchase?.txHash ? `https://stellar.expert/explorer/testnet/tx/${purchase.txHash}` : null);
  const timestamp = purchase?.timestamp || purchase?.receiptData?.timestamp || null;
  const timestampDate = timestamp ? new Date(timestamp) : null;
  const displayTime = timestampDate && !Number.isNaN(timestampDate.getTime()) ? timestampDate.toLocaleString() : 'Confirmed on Stellar';
  const truncateHash = (hash) => {
    if (!hash) return '';
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  return (
    <div className="receipt-card receipt-card--success">
      <div className="receipt-card-header">
        <CheckCircle size={16} weight="fill" style={{ marginRight: 6 }} />
        Purchase Confirmed
      </div>

      <div className="receipt-card-product">
        <div className="receipt-card-product-image">
          {product.image ? (
            <img src={product.image} alt={product.name} loading="lazy" />
          ) : (
            <ShoppingBag size={20} weight="duotone" />
          )}
        </div>
        <div className="receipt-card-product-info">
          <span className="receipt-card-product-name">{product.name}</span>
          <span className="receipt-card-product-site">{product.siteName || 'Store'}</span>
        </div>
      </div>

      <div className="receipt-card-divider" />

      <div className="receipt-card-row">
        <span className="receipt-card-label">Price ({product.currency || 'USD'})</span>
        <span className="receipt-card-value">
          {product.currency === 'INR' ? '₹' : product.currency === 'USD' ? '$' : `${product.currency || ''} `}
          {product.price?.toLocaleString()}
        </span>
      </div>

      <div className="receipt-card-row">
        <span className="receipt-card-label">Paid (XLM)</span>
        <span className="receipt-card-value receipt-card-value--xlm">
          {purchase.priceXlm} XLM
        </span>
      </div>

      <div className="receipt-card-row">
        <span className="receipt-card-label">Transaction</span>
        <span className="receipt-card-value">
          {explorerUrl ? <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="receipt-card-tx-link"
          >
            {truncateHash(purchase.txHash)}
            <ArrowSquareOut size={12} style={{ marginLeft: 3 }} />
          </a> : <span>Transaction unavailable</span>}
        </span>
      </div>

      <div className="receipt-card-row">
        <span className="receipt-card-label">Time</span>
        <span className="receipt-card-value">
          {displayTime}
        </span>
      </div>

      <div className="receipt-card-footer">
        {explorerUrl && <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="receipt-card-explorer-btn"
        >
          View on Stellar Explorer
          <ArrowSquareOut size={14} style={{ marginLeft: 4 }} />
        </a>}
      </div>
    </div>
  );
}
