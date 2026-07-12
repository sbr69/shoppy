import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import MessageBubble from './MessageBubble';
import ProductCard from './ProductCard';
import ReceiptCard from './ReceiptCard';
import TypingIndicator from './TypingIndicator';

const SUGGESTIONS = [
  'Buy wireless earbuds under ₹2000',
  'Find me a laptop bag',
  'Get 10 pens',
  'Show me mechanical keyboards',
];

export default function ChatWindow() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load chat history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadHistory = async () => {
    try {
      const { data } = await api.get('/chat/history');
      if (data.messages) {
        const enriched = data.messages.map(msg => {
          if (msg.role === 'agent' && msg.metadata) {
            if (msg.metadata.purchase?.txHash) return { ...msg, type: 'purchase_success' };
            if (msg.metadata.error && msg.metadata.product) return { ...msg, type: 'purchase_failed' };
            if (msg.metadata.product && msg.metadata.reasoning) return { ...msg, type: 'product_suggestion' };
            if (msg.metadata.status === 'pending_payment') return { ...msg, type: 'purchase_pending' };
          }
          return msg;
        });
        setMessages(enriched);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setInitialLoading(false);
    }
  };

  const sendMessage = useCallback(async (messageText) => {
    const text = messageText || input.trim();
    if (!text || loading) return;

    // Add user message to state
    const userMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post('/chat/message', { message: text });
      const response = data.response;

      // Add agent response to state
      const agentMsg = {
        id: response.id,
        role: 'agent',
        content: response.content,
        metadata: response.metadata,
        type: response.type,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, agentMsg]);
    } catch (err) {
      // Add error message
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'agent',
        content: 'Sorry, something went wrong. Please try again.',
        created_at: new Date().toISOString(),
      }]);
      console.error('Chat error:', err);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleConfirmPurchase = () => {
    sendMessage('Yes, buy it');
  };

  const handleSkip = () => {
    sendMessage('No, skip this');
  };

  const handleSuggestion = (text) => {
    sendMessage(text);
  };

  // Render a single message — handles both text and product suggestions
  const renderMessage = (msg, index) => {
    // Product suggestion card
    if (msg.type === 'product_suggestion' && msg.metadata?.product) {
      return (
        <div key={msg.id || index}>
          <MessageBubble message={msg} userAvatar={user?.avatarUrl} />
          <div style={{ marginLeft: 44, marginTop: 8 }}>
            <ProductCard
              product={msg.metadata.product}
              reasoning={msg.metadata.reasoning}
              onConfirm={handleConfirmPurchase}
              onSkip={handleSkip}
            />
          </div>
        </div>
      );
    }

    // Purchase success — show receipt card with Stellar tx link
    if (msg.type === 'purchase_success' && msg.metadata?.purchase) {
      return (
        <div key={msg.id || index}>
          <MessageBubble message={msg} userAvatar={user?.avatarUrl} />
          <div style={{ marginLeft: 44, marginTop: 8 }}>
            <ReceiptCard
              product={msg.metadata.product}
              purchase={msg.metadata.purchase}
            />
          </div>
        </div>
      );
    }

    // Purchase failed
    if (msg.type === 'purchase_failed') {
      return (
        <div key={msg.id || index}>
          <MessageBubble message={msg} userAvatar={user?.avatarUrl} />
          <div className="receipt-card receipt-card--error" style={{ marginLeft: 44, marginTop: 8 }}>
            <div className="receipt-card-header" style={{ color: 'var(--color-error, #ef4444)' }}>
              <span>&#10007;</span> Payment Failed
            </div>
            <div className="receipt-card-row">
              <span className="receipt-card-label">Reason</span>
              <span className="receipt-card-value">{msg.metadata?.error || 'Unknown error'}</span>
            </div>
          </div>
        </div>
      );
    }

    // Legacy purchase pending (from old sessions)
    if (msg.type === 'purchase_pending' && msg.metadata?.product) {
      return (
        <div key={msg.id || index}>
          <MessageBubble message={msg} userAvatar={user?.avatarUrl} />
          <div className="receipt-card" style={{ marginLeft: 44, marginTop: 8 }}>
            <div className="receipt-card-header">
              &#9203; Purchase Pending
            </div>
            <div className="receipt-card-row">
              <span className="receipt-card-label">Product</span>
              <span className="receipt-card-value">{msg.metadata.product.name}</span>
            </div>
            <div className="receipt-card-row">
              <span className="receipt-card-label">Price</span>
              <span className="receipt-card-value">
                &#8377;{msg.metadata.product.price?.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      );
    }

    // Regular text message
    return (
      <MessageBubble
        key={msg.id || index}
        message={msg}
        userAvatar={user?.avatarUrl}
      />
    );
  };

  if (initialLoading) {
    return (
      <div className="chat-container">
        <div className="chat-header">
          <div className="chat-header-title">
            <span>⚡</span>
            <h2>JarvisPayz Agent</h2>
          </div>
        </div>
        <div className="chat-messages" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-title">
          <span style={{ fontSize: '1.5rem' }}>⚡</span>
          <div>
            <h2>JarvisPayz Agent</h2>
            <div className="chat-header-status">Online</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-messages-empty">
            <div className="chat-empty-icon">🛍️</div>
            <h3>What would you like to buy?</h3>
            <p>
              Tell me what you're looking for and I'll find the best deal
              across your connected stores.
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  className="chat-suggestion-btn"
                  onClick={() => handleSuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => renderMessage(msg, i))
        )}

        {loading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Tell me what to buy..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            id="chat-input"
          />
          <button
            className="chat-send-btn"
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            id="chat-send-btn"
          >
            ↑
          </button>
        </div>
        <div className="chat-input-hint">
          Press Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
