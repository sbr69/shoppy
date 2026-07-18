import { useState } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from '../chat/ChatWindow';
import { OrdersView, StoresView, WalletActivityView } from './WorkspaceViews';
import api from '../../services/api';
import ConnectSiteModal from '../settings/ConnectSiteModal';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState('chat');
  const [sessionId, setSessionId] = useState(null);
  const [connectStoreOpen, setConnectStoreOpen] = useState(false);
  const [storeRefreshKey, setStoreRefreshKey] = useState(0);
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);

  const startNewChat = async () => {
    setView('chat');
    setSidebarOpen(false);
    try {
      const { data } = await api.post('/chat/sessions');
      setSessionId(data.session.id);
    } catch {
      // The chat endpoint will still create a session if this lightweight request fails.
      setSessionId(null);
    }
  };

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
        onConnectStore={() => { setConnectStoreOpen(true); setSidebarOpen(false); }}
        storeRefreshKey={storeRefreshKey}
        walletRefreshKey={walletRefreshKey}
      />
      {view === 'chat' && <ChatWindow
        sessionId={sessionId}
        onSessionReady={setSessionId}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        onWalletChanged={() => setWalletRefreshKey((value) => value + 1)}
      />}
      {view === 'orders' && <OrdersView />}
      {view === 'wallet' && <WalletActivityView />}
      {view === 'stores' && <StoresView onConnectStore={() => setConnectStoreOpen(true)} refreshKey={storeRefreshKey} />}
      <ConnectSiteModal
        isOpen={connectStoreOpen}
        onClose={() => { setConnectStoreOpen(false); setStoreRefreshKey((value) => value + 1); }}
      />
    </div>
  );
}
