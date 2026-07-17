import React from 'react';
import { Robot, LockKey, Lightning, Globe, Shield } from '@phosphor-icons/react';
import '../styles/landing.css';

const Features = () => {
  return (
    <section id="features" className="awwwards-section-alt">
      <div className="features-header">
        <h2>Intelligence at Scale</h2>
      </div>
      
      <div className="bento-awwwards">
        
        {/* Core AI */}
        <div className="bento-cell-8 doppelrand-shell">
          <div className="doppelrand-core">
            <div className="bento-icon-wrapper">
              <Robot weight="light" size={32} />
            </div>
            <div className="bento-core-content">
              <h3>Intent Resolution Engine</h3>
              <p>JarvisPayz uses advanced LLMs to parse conversational shopping requests into strict, executable transaction parameters.</p>
            </div>
          </div>
        </div>

        {/* Global */}
        <div className="bento-cell-4 doppelrand-shell">
          <div className="doppelrand-core">
            <div className="bento-icon-wrapper">
              <Globe weight="light" size={32} />
            </div>
            <div className="bento-core-content">
              <h3>Verified Store Access</h3>
              <p>Shops only through explicitly connected storefronts with supported agent APIs.</p>
            </div>
          </div>
        </div>

        {/* Security (Accent Cell) */}
        <div className="bento-accent bento-cell-4 doppelrand-shell">
          <div className="doppelrand-core">
            <div className="bento-icon-wrapper">
              <LockKey weight="light" size={32} />
            </div>
            <div className="bento-core-content">
              <h3>Zero-Trust Execution</h3>
              <p>Keys never reach the browser. The MVP applies durable server-side policy checks before signing.</p>
            </div>
          </div>
        </div>

        {/* Custody */}
        <div className="bento-cell-4 doppelrand-shell">
          <div className="doppelrand-core">
            <div className="bento-icon-wrapper">
              <Shield weight="light" size={32} />
            </div>
            <div className="bento-core-content">
              <h3>Custodial Wallet</h3>
              <p>Frictionless onboarding. We manage the cryptography, you manage the funds.</p>
            </div>
          </div>
        </div>

        {/* Network */}
        <div className="bento-cell-4 doppelrand-shell">
          <div className="doppelrand-core">
            <div className="bento-icon-wrapper">
              <Lightning weight="light" size={32} />
            </div>
            <div className="bento-core-content">
              <h3>Stellar Velocity</h3>
              <p>Leveraging the Stellar network for near-instant, low-cost settlement.</p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};

export default Features;
