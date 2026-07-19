export default function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="message-avatar" aria-label="JarvisPayz Agent">
        <img className="message-agent-logo" src="/logo.svg" alt="" />
      </div>
      <div className="typing-dots">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  );
}
