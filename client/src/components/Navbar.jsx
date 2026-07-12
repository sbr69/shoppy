import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lightning, List, X } from '@phosphor-icons/react';

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
    <nav className={`navbar ${scrolled ? 'scrolled' : ''} ${mobileOpen ? 'mobile-open' : ''}`} id="main-navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo" id="logo-link" onClick={() => setMobileOpen(false)}>
          <div className="navbar-logo-icon">
            <Lightning size={18} weight="fill" />
          </div>
          <span>JarvisPayz</span>
        </Link>

        <div className={`navbar-links ${mobileOpen ? 'active' : ''}`}>
          <a href="#features" className="navbar-link" onClick={() => setMobileOpen(false)}>Features</a>
          <a href="#how-it-works" className="navbar-link" onClick={() => setMobileOpen(false)}>How It Works</a>
          <button
            className="navbar-link btn-link-dashboard"
            onClick={() => { setMobileOpen(false); navigate('/dashboard'); }}
          >
            Dashboard
          </button>
        </div>

        <div className="navbar-actions">
          <button
            className="btn btn-primary"
            id="navbar-get-started"
            onClick={() => { setMobileOpen(false); navigate('/dashboard'); }}
          >
            Get Started
          </button>
          <button
            className="navbar-mobile-toggle"
            id="mobile-menu-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} weight="bold" /> : <List size={20} weight="bold" />}
          </button>
        </div>
      </div>
    </nav>
  );
}
