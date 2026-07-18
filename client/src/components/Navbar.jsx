import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Wallet, ArrowRight } from '@phosphor-icons/react';
import '../styles/landing.css';

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="island-nav-wrapper">
      <nav className={`island-nav ${scrolled ? 'scrolled' : ''}`} aria-label="Primary navigation">
        <a href="/" className="island-logo">
          <Wallet weight="light" size={24} color="var(--color-accent)" />
          JarvisPayz
        </a>
        
        <div className="island-links">
          <a href="#features" className="island-link">Platform</a>
          <a href="#how-it-works" className="island-link">How it works</a>
          <a href="#security" className="island-link">Safeguards</a>
        </div>

        <div className="island-actions">
          <button 
            className="btn-pill btn-pill-primary"
            onClick={() => navigate('/dashboard')}
          >
            {user ? 'Console' : 'Sign In'}
            <div className="btn-nested-icon">
              <ArrowRight weight="light" size={16} />
            </div>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default Navbar;
