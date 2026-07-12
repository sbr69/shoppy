export default function ProductCard({ product, reasoning, onConfirm, onSkip }) {
  return (
    <div className="product-card">
      <div className="product-card-image">
        {product.image ? (
          <img src={product.image} alt={product.name} />
        ) : (
          '🛍️'
        )}
      </div>

      <div className="product-card-body">
        <div className="product-card-site">
          <span>🏪</span>
          {product.siteName || 'Connected Store'}
        </div>

        <div className="product-card-name">{product.name}</div>
        <div className="product-card-description">{product.description}</div>

        <div className="product-card-meta">
          <span className="product-card-price">
            {product.currency === 'INR' ? '₹' : product.currency || '₹'}
            {product.price?.toLocaleString()}
          </span>
          {product.rating && (
            <span className="product-card-rating">
              ⭐ {product.rating}
            </span>
          )}
        </div>

        {reasoning && (
          <div className="product-card-reasoning">
            {reasoning}
          </div>
        )}

        <div className="product-card-actions">
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            id="product-buy-btn"
          >
            🛒 Buy This
          </button>
          <button
            className="btn btn-secondary"
            onClick={onSkip}
            id="product-skip-btn"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
