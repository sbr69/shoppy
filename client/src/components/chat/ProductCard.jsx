import { Storefront, ShoppingBag, Star, Brain, ShoppingCart, X } from '@phosphor-icons/react';

export default function ProductCard({ product, reasoning, onConfirm, onSkip, historical = false }) {
  const pricePrefix = product.currency === 'INR' ? '₹' : product.currency === 'USD' ? '$' : `${product.currency || ''} `;
  return (
    <div className="product-card">
      <div className="product-card-image">
        {product.image ? (
          <img src={product.image} alt={product.name} loading="lazy" />
        ) : (
          <ShoppingBag size={48} weight="duotone" />
        )}
      </div>

      <div className="product-card-body">
        <div className="product-card-site">
          <Storefront size={12} weight="bold" />
          {product.siteName || 'Connected Store'}
        </div>

        <div className="product-card-name">{product.name}</div>
        <div className="product-card-description">{product.description}</div>

        <div className="product-card-meta">
          <span className="product-card-price">
            {pricePrefix}
            {product.price?.toLocaleString()}
          </span>
          {product.rating && (
            <span className="product-card-rating">
              <Star size={12} weight="fill" /> {product.rating}
            </span>
          )}
        </div>

        {reasoning && (
          <div className="product-card-reasoning">
            <Brain size={14} weight="bold" style={{ marginRight: 6, display: 'inline-block', verticalAlign: 'text-bottom' }} />
            {reasoning}
          </div>
        )}

        <div className="product-card-actions">
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={historical}
            id="product-buy-btn"
          >
            <ShoppingCart size={14} weight="bold" />
            Review Checkout
          </button>
          <button
            className="btn btn-secondary"
            onClick={onSkip}
            disabled={historical}
            id="product-skip-btn"
          >
            <X size={14} weight="bold" />
            {historical ? 'Expired' : 'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}
