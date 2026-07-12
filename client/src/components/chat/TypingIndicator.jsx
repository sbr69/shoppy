export default function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="message-avatar" style={{
        background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
        color: 'white',
        width: 32,
        height: 32,
        minWidth: 32,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.875rem',
      }}>
        ⚡
      </div>
      <div className="typing-dots">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  );
}
