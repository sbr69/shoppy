import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import SettingsPanel from '../settings/SettingsPanel';
import ConfirmDialog from '../common/ConfirmDialog';
import {
  PlusCircle,
  Gear,
  SignOut,
  ChatCircleText,
  ShoppingBag,
  ClockCounterClockwise,
  DotsThree,
  PencilSimple,
  Trash,
  Check,
  X,
} from '@phosphor-icons/react';

export default function Sidebar({ isOpen, onClose, activeView = 'chat', onNavigate, onNewChat, activeSessionId, onSessionSelect, initialSessions, bootstrapLoading = false }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [sessions, setSessions] = useState(initialSessions || []);
  const [menuId, setMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const hydratedInitialSessions = useRef(false);

  useEffect(() => {
    if (bootstrapLoading) return;
    if (!hydratedInitialSessions.current && Array.isArray(initialSessions)) {
      setSessions(initialSessions);
      hydratedInitialSessions.current = true;
      return;
    }
    api.get('/chat/sessions').then(({ data }) => setSessions(data.sessions || [])).catch(() => setSessions([]));
  }, [activeSessionId, bootstrapLoading, initialSessions]);

  const selectSession = (id) => onSessionSelect?.(id);

  const beginRename = (session) => {
    setMenuId(null);
    setEditingId(session.id);
    setDraftTitle(session.title || 'New shopping chat');
  };

  const saveRename = async (event) => {
    event.preventDefault();
    if (!editingId || !draftTitle.trim()) return;
    try {
      const { data } = await api.patch(`/chat/sessions/${editingId}`, { title: draftTitle });
      setSessions((current) => current.map((session) => session.id === editingId ? data.session : session));
      setEditingId(null);
    } catch {
      // Keep the editor visible so the user can correct and retry the title.
    }
  };

  const deleteSession = async () => {
    const session = pendingDelete;
    if (!session) return;
    try {
      await api.delete(`/chat/sessions/${session.id}`);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setMenuId(null);
      setPendingDelete(null);
      if (activeSessionId === session.id) await onNewChat?.();
    } catch {
      // The next list refresh restores a session if its deletion did not complete.
    }
  };

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
          <div className="navbar-logo" onClick={() => { onClose(); navigate('/'); }} style={{ cursor: 'pointer', gap: '8px' }}>
            <img src="/logo.svg" alt="JarvisPayz Logo" style={{ width: 35, height: 35, display: 'block' }} />
            <span style={{ fontWeight: 700 }}>JarvisPayz</span>
          </div>
          <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">
            <X size={20} weight="bold" />
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
        </nav>

        <div className="sidebar-history">
          <div className="sidebar-history-head">
            <span>Chat history</span>
            <button onClick={onNewChat} title="New chat" aria-label="Start a new chat">
              <PlusCircle size={16} />
            </button>
          </div>
          <button className="sidebar-new-chat" onClick={onNewChat}>
            <PlusCircle size={15} />
            <span>New chat</span>
          </button>
          <div className="sidebar-sessions-list">
            {sessions.slice(0, 8).map((session) => (
              <div className={`sidebar-session-row ${activeSessionId === session.id ? 'active' : ''}`} key={session.id}>
                {editingId === session.id ? (
                  <form className="sidebar-session-rename" onSubmit={saveRename}>
                    <input aria-label="Chat name" autoFocus value={draftTitle} maxLength={72} onChange={(event) => setDraftTitle(event.target.value)} />
                    <button type="submit" aria-label="Save chat name"><Check size={14} /></button>
                    <button type="button" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X size={14} /></button>
                  </form>
                ) : (
                  <>
                    <button className="sidebar-session" onClick={() => selectSession(session.id)} title={session.title || 'New shopping chat'}>
                      {session.title || 'New shopping chat'}
                    </button>
                    <button className="sidebar-session-more" onClick={() => setMenuId((current) => current === session.id ? null : session.id)} aria-label={`Options for ${session.title || 'chat'}`} aria-expanded={menuId === session.id}>
                      <DotsThree size={18} weight="bold" />
                    </button>
                    {menuId === session.id && (
                      <div className="sidebar-session-menu" role="menu">
                        <button role="menuitem" onClick={() => beginRename(session)}><PencilSimple size={14} /> Rename</button>
                        <button role="menuitem" className="danger" onClick={() => { setMenuId(null); setPendingDelete(session); }}><Trash size={14} /> Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>
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
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="Delete this chat?"
        description="This removes the conversation from your chat history. This action cannot be undone."
        confirmLabel="Delete chat"
        onConfirm={deleteSession}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
