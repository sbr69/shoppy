import React from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import '../styles/landing.css';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const Hero = ({ onSignIn }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <section className="hero-awwwards">
      <div className="hero-grid">
        <aside className="hero-index" aria-hidden="true">
          <span>SBR</span>
        </aside>
        <div className="hero-content">
          <div className="eyebrow-tag">Controlled agentic commerce</div>
          <h1>
            Ask once.<br />
            Shop with<br />
            <em>confidence.</em>
          </h1>
          <p>
            A calm, conversational way to search your connected stores, review every checkout, and pay through your protected Stellar smart wallet.
          </p>
          <div className="hero-actions">
             <button className="btn-pill btn-pill-primary" onClick={() => user ? navigate('/dashboard') : onSignIn()}>
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
                <span className="prompt">›</span> Find wireless earbuds under 2,000 rupees
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-jarvis">[Agent]</span> Comparing your connected stores...
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-jarvis">[Match]</span> Best fit found · ₹1,899
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-guard">[Safeguard]</span> Budget check... <span className="status-ok">Approved</span>
                </div>
                <div className="terminal-line response-line">
                  <span className="tag-stellar">[Stellar]</span> Awaiting your checkout approval...
                </div>
                <div className="terminal-line response-line success-text">
                  <span className="tag-stellar">[Receipt]</span> Ready when you are
                </div>
                <div className="terminal-status-success">
                  YOU STAY IN CONTROL
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
