import { useNavigate } from 'react-router-dom';

export default function CTASection() {
  const navigate = useNavigate();

  return (
    <section className="cta-section section" id="cta-section">
      <div className="container">
        <div className="cta-box">
          <h2>Ready to Let AI Handle<br />Your Shopping?</h2>
          <p>
            Sign up in seconds. No wallet extensions needed.
            Just your Google account and a shopping list.
          </p>
          <button
            className="btn btn-primary btn-lg"
            id="cta-get-started"
            onClick={() => navigate('/dashboard')}
          >
            Get Started — It's Free
            <span style={{ fontSize: '1.2em' }}>→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
