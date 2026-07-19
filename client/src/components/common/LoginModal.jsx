import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import { X } from '@phosphor-icons/react';
import StellarWalletLoginButton from './StellarWalletLoginButton';

export default function LoginModal({ isOpen, onClose }) {
  const { loginWithGoogle, loginWithStellar } = useAuth();
  const navigate = useNavigate();
  const [loginError, setLoginError] = useState('');
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animateOut, setAnimateOut] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimateOut(false);
    } else if (shouldRender) {
      setAnimateOut(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimateOut(false);
      }, 280);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!shouldRender || animateOut) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shouldRender, animateOut, onClose]);

  if (!shouldRender) return null;

  return (
    <div className={`modal-overlay ${animateOut ? 'animate-out' : ''}`} onClick={onClose}>
      <div 
        className={`modal-card glass-card login-modal-card ${animateOut ? 'animate-out' : ''}`} 
        role="dialog" 
        aria-modal="true" 
        onClick={(e) => e.stopPropagation()}
      >
        <button 
          className="modal-close" 
          onClick={onClose} 
          aria-label="Close login dialog"
          style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}
        >
          <X size={16} />
        </button>

        <div className="login-modal-header">
          <div className="navbar-logo">
            <img src="/logo.svg" alt="JarvisPayz Logo" style={{ width: 44, height: 44, display: 'block' }} />
            <span style={{ fontSize: '1.6rem', fontWeight: 700 }}>JarvisPayz</span>
          </div>
          <h2>Welcome Back</h2>
          <p>
            Use Google or your own Stellar wallet to access your AI shopping agent.
          </p>
        </div>

        <div className="login-modal-body">
          <GoogleLogin
            onSuccess={async (credentialResponse) => {
              try {
                setLoginError('');
                await loginWithGoogle(credentialResponse.credential);
                onClose();
                navigate('/dashboard', { replace: true });
              } catch (err) {
                console.error('Login error:', err);
                setLoginError(err.response?.data?.details || err.response?.data?.error || 'Unable to sign in. Please try again.');
              }
            }}
            onError={() => {
              console.error('Google Login Failed');
            }}
            theme="filled_black"
            size="large"
            width="320"
            text="signin_with"
            shape="pill"
          />
          <div className="login-method-divider" aria-hidden="true"><span>or</span></div>
          <StellarWalletLoginButton
            onSuccess={async (data) => { await loginWithStellar(data); onClose(); navigate('/dashboard', { replace: true }); }}
            onError={setLoginError}
          />
          {loginError && <p className="login-error" role="alert" style={{ color: '#813f3c', fontSize: '0.84rem', margin: 0 }}>{loginError}</p>}
        </div>

        <div className="login-modal-footer">
          <p>
            Your managed shopping wallet is created separately and connected automatically.
            <br />
            Your external wallet is only used to prove your identity.
          </p>
        </div>
      </div>
    </div>
  );
}
