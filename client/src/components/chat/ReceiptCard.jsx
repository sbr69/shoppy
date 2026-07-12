export default function ReceiptCard({ product, purchase }) {
  const truncateHash = (hash) => {
    if (!hash) return '';
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  return (
    <div className="receipt-card receipt-card--success">
      <div className="receipt-card-header">
        <span className="receipt-card-icon">&#10003;</span>
        Purchase Confirmed
      </div>

      <div className="receipt-card-product">
        <div className="receipt-card-product-image">
          {product.image ? (
            <img src={product.image} alt={product.name} />
          ) : (
            <span>&#128722;</span>
          )}
        </div>
        <div className="receipt-card-product-info">
          <span className="receipt-card-product-name">{product.name}</span>
          <span className="receipt-card-product-site">{product.siteName || 'Store'}</span>
        </div>
      </div>

      <div className="receipt-card-divider" />

      <div className="receipt-card-row">
        <span className="receipt-card-label">Price (INR)</span>
        <span className="receipt-card-value">
          {product.currency === 'INR' ? '₹' : product.currency || '₹'}
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
          <a
            href={purchase.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="receipt-card-tx-link"
          >
            {truncateHash(purchase.txHash)}
            <span className="receipt-card-external-icon">&#8599;</span>
          </a>
        </span>
      </div>

      <div className="receipt-card-row">
        <span className="receipt-card-label">Time</span>
        <span className="receipt-card-value">
          {new Date(purchase.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="receipt-card-footer">
        <a
          href={purchase.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="receipt-card-explorer-btn"
        >
          View on Stellar Explorer &#8599;
        </a>
      </div>
    </div>
  );
}
