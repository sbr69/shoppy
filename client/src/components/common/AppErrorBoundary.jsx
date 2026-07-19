import { Component } from 'react';
import { captureClientException } from '../../services/observability';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    captureClientException(error, { feature: 'render', component_stack: info.componentStack ? 'present' : 'absent' });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="app-error-boundary" role="alert" aria-live="assertive">
        <p className="app-error-boundary__eyebrow">JarvisPayz</p>
        <h1>Something needs a fresh start.</h1>
        <p>The shopping agent has not sent a payment. Reload to continue safely.</p>
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    );
  }
}
