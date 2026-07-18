import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import SettingsPanel from '../settings/SettingsPanel';
import {
  Lightning,
  PlusCircle,
  Gear,
  SignOut,
  ChatCircleText,
  ShoppingBag,
  ClockCounterClockwise,
  ShieldCheck,
} from '@phosphor-icons/react';

export default function Sidebar({ isOpen, onClose, activeView = 'chat', onNavigate, onNewChat, activeSessionId, onSessionSelect, onConnectStore, storeRefreshKey }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    api.get('/chat/sessions').then(({ data }) => setSessions(data.sessions || [])).catch(() => setSessions([]));
  }, [activeSessionId]);

  const selectSession = (id) => onSessionSelect?.(id);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="navbar-logo" onClick={() => { onClose(); navigate('/'); }} style={{ cursor: 'pointer' }}>
            <div className="navbar-logo-icon">
              <Lightning size={16} weight="fill" />
            </div>
            <span>JarvisPayz</span>
          </div>
          <button className="sidebar-user-btn" title={user?.email}>
            {user?.avatarUrl && (
              <img src={user.avatarUrl} alt={user.name} referrerPolicy="no-referrer" />
            )}
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace">
          <button className={activeView === 'chat' ? 'active' : ''} onClick={() => onNavigate?.('chat')}>
            <ChatCircleText size={17} />
            <span>Shop assistant</span>
          </button>
          <button className={activeView === 'orders' ? 'active' : ''} onClick={() => onNavigate?.('orders')}>
            <ShoppingBag size={17} />
            <span>Orders</span>
          </button>
          <button className={activeView === 'wallet' ? 'active' : ''} onClick={() => onNavigate?.('wallet')}>
            <ClockCounterClockwise size={17} />
            <span>Wallet activity</span>
          </button>
          <button className={activeView === 'stores' ? 'active' : ''} onClick={() => onNavigate?.('stores')}>
            <ShieldCheck size={17} />
            <span>Stores & safeguards</span>
          </button>
        </nav>

        <div className="sidebar-history">
          <div className="sidebar-history-head">
            <span>Chat history</span>
            <button onClick={onNewChat} title="New chat">
              <PlusCircle size={16} />
            </button>
          </div>
          <button className="sidebar-new-chat" onClick={onNewChat}>
            <PlusCircle size={15} />
            <span>New chat</span>
          </button>
          <div className="sidebar-sessions-list">
            {sessions.slice(0, 8).map((session) => (
              <button
                className={`sidebar-session ${activeSessionId === session.id ? 'active' : ''}`}
                key={session.id}
                onClick={() => selectSession(session.id)}
              >
                {session.title || 'New shopping chat'}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
            <Gear size={14} />
            <span>Settings</span>
          </button>
          <button className="btn btn-ghost" onClick={handleLogout}>
            <SignOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}
