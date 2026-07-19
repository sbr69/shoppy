import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from '../chat/ChatWindow';
import TelemetryPanel from './TelemetryPanel';
import { OrdersView, WalletActivityView } from './WorkspaceViews';
import api from '../../services/api';
import ConnectSiteModal from '../settings/ConnectSiteModal';
import StoreDetailsModal from '../settings/StoreDetailsModal';

function WorkspaceLoadingSkeleton({ telemetryOpen }) {
  return (
    <div className="chat-workspace workspace-loading-shell" aria-busy="true" aria-live="polite">
      <p className="sr-only">Preparing your shopping workspace.</p>
      <section className="chat-container workspace-skeleton-card" aria-hidden="true">
        <div className="workspace-skeleton-chat-header">
          <span className="workspace-skeleton-avatar" />
          <div>
            <span className="workspace-skeleton-line workspace-skeleton-title" />
            <span className="workspace-skeleton-line workspace-skeleton-status" />
          </div>
          <span className="workspace-skeleton-control" />
        </div>
        <div className="workspace-skeleton-messages">
          <div className="workspace-skeleton-message">
            <span className="workspace-skeleton-avatar workspace-skeleton-avatar--small" />
            <span className="workspace-skeleton-bubble workspace-skeleton-bubble--wide" />
          </div>
          <div className="workspace-skeleton-message workspace-skeleton-message--user">
            <span className="workspace-skeleton-bubble workspace-skeleton-bubble--medium" />
          </div>
          <div className="workspace-skeleton-message">
            <span className="workspace-skeleton-avatar workspace-skeleton-avatar--small" />
            <span className="workspace-skeleton-bubble workspace-skeleton-bubble--short" />
          </div>
        </div>
        <div className="workspace-skeleton-input">
          <span className="workspace-skeleton-line workspace-skeleton-input-line" />
          <span className="workspace-skeleton-control" />
        </div>
      </section>
      {telemetryOpen && (
        <aside className="telemetry-panel workspace-skeleton-panel" aria-hidden="true">
          <div className="workspace-skeleton-panel-header">
            <span className="workspace-skeleton-avatar workspace-skeleton-avatar--small" />
            <span className="workspace-skeleton-line workspace-skeleton-panel-title" />
          </div>
          <div className="workspace-skeleton-panel-body">
            <span className="workspace-skeleton-eyebrow" />
            <div className="workspace-skeleton-metric-card">
              <span className="workspace-skeleton-line workspace-skeleton-balance" />
              <span className="workspace-skeleton-line workspace-skeleton-address" />
              <div className="workspace-skeleton-actions">
                <span className="workspace-skeleton-button" />
                <span className="workspace-skeleton-button" />
              </div>
            </div>
            <span className="workspace-skeleton-eyebrow" />
            <div className="workspace-skeleton-store" />
            <div className="workspace-skeleton-store workspace-skeleton-store--short" />
          </div>
        </aside>
      )}
    </div>
  );
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState('chat');
  const [sessionId, setSessionId] = useState(null);
  const [sessionBootstrapping, setSessionBootstrapping] = useState(true);
  const [connectStoreOpen, setConnectStoreOpen] = useState(false);
  const [storeRefreshKey, setStoreRefreshKey] = useState(0);
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);
  const [telemetryOpen, setTelemetryOpen] = useState(true);
  const [selectedStore, setSelectedStore] = useState(null);
  const initialSessionRequested = useRef(false);

  const startNewChat = useCallback(async ({ initial = false } = {}) => {
    setView('chat');
    setSidebarOpen(false);
    try {
      const { data } = await api.post('/chat/sessions', initial ? { reuseBlank: true } : {});
      setSessionId(data.session.id);
    } catch {
      // The chat endpoint will still create a session if this lightweight request fails.
      setSessionId(null);
    } finally {
      if (initial) setSessionBootstrapping(false);
    }
  }, []);

  // Each dashboard visit deliberately begins a clean conversation. Older
  // chats are retained in history and only load when the user selects one.
  useEffect(() => {
    if (initialSessionRequested.current) return;
    initialSessionRequested.current = true;
    void startNewChat({ initial: true });
  }, [startNewChat]);

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeView={view}
        onNavigate={(next) => { setView(next); setSidebarOpen(false); }}
        onNewChat={startNewChat}
        activeSessionId={sessionId}
        onSessionSelect={(id) => { setSessionId(id); setView('chat'); setSidebarOpen(false); }}
      />
      {view === 'chat' && (sessionBootstrapping ? (
        <WorkspaceLoadingSkeleton telemetryOpen={telemetryOpen} />
      ) : (
        <div className="chat-workspace">
          <ChatWindow
            sessionId={sessionId}
            onSessionReady={setSessionId}
            onToggleTelemetry={() => setTelemetryOpen(prev => !prev)}
            telemetryOpen={telemetryOpen}
            onWalletChanged={() => setWalletRefreshKey((value) => value + 1)}
          />
          <TelemetryPanel
            isOpen={telemetryOpen}
            onConnectStore={() => setConnectStoreOpen(true)}
            storeRefreshKey={storeRefreshKey}
            walletRefreshKey={walletRefreshKey}
            onWalletChanged={() => setWalletRefreshKey((value) => value + 1)}
            onStoreSelect={setSelectedStore}
          />
        </div>
      ))}
      {view === 'orders' && <OrdersView />}
      {view === 'wallet' && <WalletActivityView />}
      <ConnectSiteModal
        isOpen={connectStoreOpen}
        onClose={() => { setConnectStoreOpen(false); setStoreRefreshKey((value) => value + 1); }}
      />
      <StoreDetailsModal
        site={selectedStore}
        onClose={() => setSelectedStore(null)}
        onUpdated={(site) => { setSelectedStore(site); setStoreRefreshKey((value) => value + 1); }}
        onDisconnected={() => { setSelectedStore(null); setStoreRefreshKey((value) => value + 1); }}
      />
    </div>
  );
}
