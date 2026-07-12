import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="notfound-page">
      <div className="notfound-bg">
        <div className="hero-gradient-orb" />
        <div className="hero-gradient-orb" />
        <div className="hero-grid" />
      </div>

      <div className="notfound-content">
        <div className="notfound-code">404</div>
        <h1>Page Not Found</h1>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <div className="notfound-actions">
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/')}>
            Go Home
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
