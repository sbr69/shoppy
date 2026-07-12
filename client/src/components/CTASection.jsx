import React from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import '../styles/landing.css';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const CTASection = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <section className="cta-massive">
      <div className="eyebrow-tag">Get Started</div>
      <h2>
        The Future of<br />
        Commerce.
      </h2>
      {user ? (
        <button className="btn-pill btn-pill-primary" onClick={() => navigate('/dashboard')}>
          Access Console
          <div className="btn-nested-icon">
            <ArrowRight weight="light" size={16} />
          </div>
        </button>
      ) : (
        <button className="btn-pill btn-pill-primary" onClick={() => navigate('/dashboard')}>
          Initialize Jarvis
          <div className="btn-nested-icon">
            <ArrowRight weight="light" size={16} />
          </div>
        </button>
      )}
    </section>
  );
};

export default CTASection;
