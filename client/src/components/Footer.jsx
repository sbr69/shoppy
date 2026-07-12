import { Link } from 'react-router-dom';
import { Lightning } from '@phosphor-icons/react';

export default function Footer() {
  return (
    <footer className="footer" id="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-brand">
            <Link to="/" className="navbar-logo">
              <div className="navbar-logo-icon">
                <Lightning size={16} weight="fill" />
              </div>
              <span>JarvisPayz</span>
            </Link>
            <p>
              An AI-powered autonomous shopping agent governed by
              on-chain spending policies on Stellar. Shop smarter,
              not harder.
            </p>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#faq">FAQ</a>
          </div>

          <div className="footer-col">
            <h4>Developers</h4>
            <a href="https://stellar.org" target="_blank" rel="noopener noreferrer">Stellar Docs</a>
            <a href="https://soroban.stellar.org" target="_blank" rel="noopener noreferrer">Soroban</a>
            <a href="https://horizon-testnet.stellar.org" target="_blank" rel="noopener noreferrer">Horizon API</a>
          </div>

          <div className="footer-col">
            <h4>Legal</h4>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Cookie Policy</a>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} JarvisPayz. All rights reserved.</p>
          <div className="footer-bottom-links">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer">Twitter</a>
            <a href="https://discord.com" target="_blank" rel="noopener noreferrer">Discord</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
