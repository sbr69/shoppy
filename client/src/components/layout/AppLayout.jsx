import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from '../chat/ChatWindow';
import TelemetryPanel from './TelemetryPanel';
import { OrdersView, WalletActivityView } from './WorkspaceViews';
import api from '../../services/api';
import ConnectSiteModal from '../settings/ConnectSiteModal';
import StoreDetailsModal from '../settings/StoreDetailsModal';

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
      {view === 'chat' && !sessionBootstrapping && (
        <div className="chat-workspace">
          <ChatWindow
            sessionId={sessionId}
            onSessionReady={setSessionId}
            onToggleSidebar={() => setSidebarOpen(prev => !prev)}
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
      )}
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
