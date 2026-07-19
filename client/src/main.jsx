import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initializeClientObservability } from './services/observability';
import './styles/global.css';
import './styles/landing.css';
import './styles/dashboard.css';
import './styles/chat.css';
import './styles/settings.css';
import './styles/workspace.css';
import './styles/premium.css';

void initializeClientObservability();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
