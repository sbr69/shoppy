import { useState } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from '../chat/ChatWindow';
import { OrdersView, StoresView, WalletActivityView } from './WorkspaceViews';
import api from '../../services/api';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState('chat');
  const [sessionId, setSessionId] = useState(null);

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
      />
      {view === 'chat' && <ChatWindow
        sessionId={sessionId}
        onSessionReady={setSessionId}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
      />}
      {view === 'orders' && <OrdersView />}
      {view === 'wallet' && <WalletActivityView />}
      {view === 'stores' && <StoresView />}
    </div>
  );
}
