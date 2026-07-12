import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav className={`navbar ${scrolled ? 'scrolled' : ''}`} id="main-navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo" id="logo-link">
          <div className="navbar-logo-icon">⚡</div>
          <span>JarvisPayz</span>
        </Link>

        <div className="navbar-links">
          <a href="#features" className="navbar-link">Features</a>
          <a href="#how-it-works" className="navbar-link">How It Works</a>
          <a href="#faq" className="navbar-link">FAQ</a>
        </div>

        <div className="navbar-actions">
          <button
            className="btn btn-primary"
            id="navbar-get-started"
            onClick={() => navigate('/dashboard')}
          >
            Get Started
          </button>
          <button
            className="navbar-mobile-toggle"
            id="mobile-menu-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>
    </nav>
  );
}
