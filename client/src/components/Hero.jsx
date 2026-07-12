import { useNavigate } from 'react-router-dom';
import { ArrowRight } from '@phosphor-icons/react';

export default function Hero() {
  const navigate = useNavigate();

  return (
    <section className="hero" id="hero-section">
      {/* Background effects */}
      <div className="hero-bg">
        <div className="hero-gradient-orb" />
        <div className="hero-gradient-orb" />
        <div className="hero-gradient-orb" />
        <div className="hero-grid" />
      </div>

      <div className="hero-content">
        <div className="hero-badge">
          <span className="badge">
            ✦ Powered by Stellar Blockchain
          </span>
        </div>

        <h1>
          Your AI Agent That<br />
          <span className="gradient-text">Actually Shops</span> For You
        </h1>

        <p className="hero-subtitle">
          Just tell JarvisPayz what to buy. It searches connected stores,
          checkouts securely, and pays using on-chain spending controls.
        </p>

        <div className="hero-actions">
          <button
            className="btn btn-primary btn-lg"
            id="hero-cta-primary"
            onClick={() => navigate('/dashboard')}
          >
            Start Shopping with AI
            <ArrowRight size={16} weight="bold" style={{ marginLeft: 6 }} />
          </button>
          <a href="#how-it-works" className="btn btn-secondary btn-lg" id="hero-cta-secondary">
            See How It Works
          </a>
        </div>

        <div className="hero-stats">
          <div className="hero-stat">
            <div className="hero-stat-value">5s</div>
            <div className="hero-stat-label">Settlement Time</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-value">&lt;$0.01</div>
            <div className="hero-stat-label">Per Transaction</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-value">100%</div>
            <div className="hero-stat-label">On-Chain Receipts</div>
          </div>
        </div>
      </div>
    </section>
  );
}
