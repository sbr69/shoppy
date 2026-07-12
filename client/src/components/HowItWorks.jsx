import React from 'react';
import '../styles/landing.css';

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="awwwards-section">
      <div className="timeline-awwwards">
        
        <div className="timeline-step">
          <div className="step-number">01</div>
          <div className="step-details">
            <h3>Intent Declaration</h3>
            <p>You interact with Jarvis via chat. State what you want to buy, your budget, and any specific parameters.</p>
          </div>
        </div>

        <div className="timeline-step">
          <div className="step-number">02</div>
          <div className="step-details">
            <h3>Contract Validation</h3>
            <p>The AI translates your intent into a strict SpendGuard contract policy, deployed on the Soroban network.</p>
          </div>
        </div>

        <div className="timeline-step">
          <div className="step-number">03</div>
          <div className="step-details">
            <h3>Secure Execution</h3>
            <p>Jarvis navigates the storefront. The transaction only clears if all conditions strictly match the on-chain policy.</p>
          </div>
        </div>

      </div>
    </section>
  );
};

export default HowItWorks;
