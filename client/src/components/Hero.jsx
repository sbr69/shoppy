import React from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import '../styles/landing.css';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const Hero = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <section className="hero-awwwards">
      <div className="hero-grid">
        <div className="hero-content">
          <div className="eyebrow-tag">Autonomous Commerce</div>
          <h1>
            Shop<br />
            Without<br />
            Thinking.
          </h1>
          <p>
            The world's first AI agent that securely executes purchases across any e-commerce platform using self-custodial Stellar smart contracts.
          </p>
          <div className="hero-actions">
             <button className="btn-pill btn-pill-primary" onClick={() => navigate('/dashboard')}>
               {user ? 'Enter Console' : 'Initialize Agent'}
               <div className="btn-nested-icon">
                 <ArrowRight weight="light" size={16} />
               </div>
             </button>
          </div>
        </div>
        
        <div className="hero-visual">
          <div className="doppelrand-shell mock-terminal">
            <div className="doppelrand-core terminal-core">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <span className="dot dot-red"></span>
                  <span className="dot dot-yellow"></span>
                  <span className="dot dot-green"></span>
                </div>
                <span className="terminal-title">jarvis_agent.sh</span>
              </div>
              <div className="terminal-body">
                <div className="terminal-line input-line">
                  <span className="prompt">$</span> jarvis buy "Keychron Q1" --max-budget 150
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-jarvis">[Jarvis]</span> Resolving product details...
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-jarvis">[Jarvis]</span> Found at Store: $139.00 USD
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-guard">[SpendGuard]</span> Policy verification... <span className="status-ok">Approved</span>
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-stellar">[Stellar]</span> Signing transaction...
                </div>
                <div className="terminal-line response-line success-text">
                  <span className="tag-stellar">[Stellar]</span> Tx hash: <span className="hash-val">0x8a92...cf3b</span>
                </div>
                <div className="terminal-status-success">
                  TRANSACTION COMPLETED SECURELY
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
