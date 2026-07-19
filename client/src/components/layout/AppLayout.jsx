import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from '../chat/ChatWindow';
import TelemetryPanel from './TelemetryPanel';
import { OrdersView, WalletActivityView } from './WorkspaceViews';
import api from '../../services/api';
import ConnectSiteModal from '../settings/ConnectSiteModal';
import StoreDetailsModal from '../settings/StoreDetailsModal';
import { ChatCircleText, ShoppingBag, ClockCounterClockwise, List, ShieldCheck } from '@phosphor-icons/react';

function WorkspaceLoadingSkeleton() {
  return (
    <section className="chat-container workspace-skeleton-card workspace-loading-shell" aria-busy="true" aria-live="polite">
      <p className="sr-only">Preparing your shopping workspace.</p>
      <div aria-hidden="true">
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
      </div>
    </section>
  );
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState('chat');
  const [sessionId, setSessionId] = useState(null);
  const [sessionBootstrapping, setSessionBootstrapping] = useState(true);
  const [bootstrap, setBootstrap] = useState(null);
  const [connectStoreOpen, setConnectStoreOpen] = useState(false);
  const [storeRefreshKey, setStoreRefreshKey] = useState(0);
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);
  const [telemetryOpen, setTelemetryOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [selectedStore, setSelectedStore] = useState(null);
  const initialSessionRequested = useRef(false);

  const startNewChat = useCallback(async () => {
    setView('chat');
    setSidebarOpen(false);
    try {
      const { data } = await api.post('/chat/sessions');
      setSessionId(data.session.id);
    } catch {
      // The chat endpoint will still create a session if this lightweight request fails.
      setSessionId(null);
    }
  }, []);

  useEffect(() => {
    if (initialSessionRequested.current) return;
    initialSessionRequested.current = true;
    api.get('/chat/bootstrap')
      .then(({ data }) => {
        setBootstrap(data);
        setSessionId(data.session?.id || null);
      })
      // Fall back to each panel's own request path if bootstrap is temporarily unavailable.
      .catch(() => setBootstrap(null))
      .finally(() => setSessionBootstrapping(false));
  }, []);

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
        initialSessions={bootstrap?.sessions}
        bootstrapLoading={sessionBootstrapping}
      />
      {view === 'chat' && (
        <div className="chat-workspace">
          {sessionBootstrapping ? (
            <WorkspaceLoadingSkeleton />
          ) : (
            <ChatWindow
              sessionId={sessionId}
              onSessionReady={setSessionId}
              initialMessages={bootstrap?.session?.id === sessionId ? bootstrap.messages : undefined}
              onToggleTelemetry={() => setTelemetryOpen(prev => !prev)}
              telemetryOpen={telemetryOpen}
              onWalletChanged={() => setWalletRefreshKey((value) => value + 1)}
              onToggleSidebar={() => setSidebarOpen(prev => !prev)}
            />
          )}
          <TelemetryPanel
            isOpen={telemetryOpen}
            onClose={() => setTelemetryOpen(false)}
            onConnectStore={() => setConnectStoreOpen(true)}
            storeRefreshKey={storeRefreshKey}
            walletRefreshKey={walletRefreshKey}
            onWalletChanged={() => setWalletRefreshKey((value) => value + 1)}
            onStoreSelect={setSelectedStore}
            initialSites={bootstrap?.sites}
            bootstrapLoading={sessionBootstrapping}
          />
        </div>
      )}
      {view === 'orders' && <OrdersView onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />}
      {view === 'wallet' && <WalletActivityView onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />}
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
