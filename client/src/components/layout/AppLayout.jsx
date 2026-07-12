import { useState } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from '../chat/ChatWindow';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <ChatWindow
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
      />
    </div>
  );
}
