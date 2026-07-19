import { User } from '@phosphor-icons/react';

function InlineText({ value }) {
  return String(value).split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  ));
}

function RichAgentMessage({ content }) {
  const blocks = String(content || '').trim().split(/\n{2,}/).filter(Boolean);
  return (
    <div className="agent-message-format">
      {blocks.map((block, index) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
        const heading = lines.length === 1 && /^\*\*[^*]+\*\*$/.test(lines[0]);
        const list = lines.length && lines.every((line) => /^[-•]\s+/.test(line));
        if (heading) return <h3 key={index}>{lines[0].slice(2, -2)}</h3>;
        if (list) return <ul key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}><InlineText value={line.replace(/^[-•]\s+/, '')} /></li>)}</ul>;
        return <p key={index}><InlineText value={lines.join(' ')} /></p>;
      })}
    </div>
  );
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isStructured = !isUser && /^\s*\*\*[^*]+\*\*/.test(String(message.content || ''));
  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`message ${isUser ? 'user' : 'agent'}`}>
      <div className="message-avatar">
        {isUser ? <User size={15} weight="bold" aria-label="You" /> : <img className="message-agent-logo" src="/logo.svg" alt="JarvisPayz Agent" />}
      </div>
      <div className="message-content">
        <div className={`message-bubble ${!isUser ? 'message-bubble--agent-format' : ''} ${isStructured ? 'message-bubble--structured' : ''}`}>
          {isUser ? message.content : <RichAgentMessage content={message.content} />}
        </div>
        {time && <span className="message-time">{time}</span>}
      </div>
    </div>
  );
}
