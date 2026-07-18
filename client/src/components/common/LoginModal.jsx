import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import { X } from '@phosphor-icons/react';

export default function LoginModal({ isOpen, onClose }) {
  const { loginWithGoogle } = useAuth();
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
    <div className={`modal-overlay ${animateOut ? 'animate-out' : ''}`} onClick={onClose} style={{ zIndex: 1000 }}>
      <div 
        className={`modal-card glass-card login-modal-card ${animateOut ? 'animate-out' : ''}`} 
        role="dialog" 
        aria-modal="true" 
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '400px', width: '90%', padding: '2rem', textAlign: 'center' }}
      >
        <button 
          className="modal-close" 
          onClick={onClose} 
          aria-label="Close login dialog"
          style={{ position: 'absolute', top: '1rem', right: '1rem' }}
        >
          <X size={16} />
        </button>

        <div className="login-card-header" style={{ marginBottom: '1.75rem' }}>
          <div className="navbar-logo" style={{ justifyContent: 'center', gap: '10px', marginBottom: '1.25rem' }}>
            <img src="/logo.svg" alt="JarvisPayz Logo" style={{ width: 44, height: 44, display: 'block' }} />
            <span style={{ fontSize: '1.6rem', fontWeight: 700 }}>JarvisPayz</span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.5rem' }}>Welcome Back</h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--ink-soft)', lineHeight: 1.5, margin: 0 }}>
            Sign in with Google to access your AI shopping agent and managed Stellar wallet.
          </p>
        </div>

        <div className="login-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginBottom: '1.75rem' }}>
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
          {loginError && <p className="login-error" role="alert" style={{ color: '#813f3c', fontSize: '0.84rem', margin: 0 }}>{loginError}</p>}
        </div>

        <div className="login-card-footer" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', lineHeight: 1.45, margin: 0 }}>
            Your Stellar wallet is created and connected automatically.
            <br />
            No extensions or seed phrases needed.
          </p>
        </div>
      </div>
    </div>
  );
}
