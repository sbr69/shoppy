import { User, Lightning } from '@phosphor-icons/react';

export default function MessageBubble({ message, userAvatar }) {
  const isUser = message.role === 'user';
  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`message ${isUser ? 'user' : 'agent'}`}>
      <div className="message-avatar">
        {isUser ? (
          userAvatar ? <img src={userAvatar} alt="You" referrerPolicy="no-referrer" /> : <User size={14} weight="bold" />
        ) : (
          <Lightning size={14} weight="fill" />
        )}
      </div>
      <div className="message-content">
        <div className="message-bubble">{message.content}</div>
        {time && <span className="message-time">{time}</span>}
      </div>
    </div>
  );
}
