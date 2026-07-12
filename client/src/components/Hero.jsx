import { useNavigate } from 'react-router-dom';

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
          Tell JarvisPayz what you want. It finds the best deal across your
          connected stores, handles checkout, and pays — all with on-chain
          spending controls you set.
        </p>

        <div className="hero-actions">
          <button
            className="btn btn-primary btn-lg"
            id="hero-cta-primary"
            onClick={() => navigate('/dashboard')}
          >
            Start Shopping with AI
            <span style={{ fontSize: '1.2em' }}>→</span>
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
