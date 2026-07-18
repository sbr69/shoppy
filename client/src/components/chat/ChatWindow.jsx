import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import MessageBubble from './MessageBubble';
import ProductCard from './ProductCard';
import ReceiptCard from './ReceiptCard';
import TypingIndicator from './TypingIndicator';
import { Lightning, ShoppingBagOpen, PaperPlaneRight, XCircle, Hourglass, Sliders } from '@phosphor-icons/react';

const SUGGESTIONS = [
  'Find wireless audio under 300 XLM',
  'Show me a practical travel accessory',
  'Browse useful desk accessories',
  'Find a gift under 500 XLM',
];

export default function ChatWindow({ onToggleTelemetry, telemetryOpen, sessionId, onSessionReady, onWalletChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get('/chat/history', { params: sessionId ? { sessionId } : {} });
      if (data.sessionId && data.sessionId !== sessionId) onSessionReady?.(data.sessionId);
      if (data.messages) {
        const enriched = data.messages.map(msg => {
          if (msg.role === 'agent' && msg.metadata) {
            if (msg.metadata.purchase?.txHash) return { ...msg, type: msg.metadata.purchase.pendingMerchantConfirmation ? 'purchase_pending' : 'purchase_success' };
            if (msg.metadata.error && msg.metadata.product) return { ...msg, type: 'purchase_failed' };
            if (msg.metadata.product && msg.metadata.reasoning) return { ...msg, type: 'product_suggestion', historical: true };
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
  }, [sessionId, onSessionReady]);

  useEffect(() => {
    setInitialLoading(true);
    setMessages([]);
    void loadHistory();
  }, [loadHistory]);

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
      const { data } = await api.post('/chat/message', { message: text, ...(sessionId ? { sessionId } : {}) });
      if (data.sessionId && data.sessionId !== sessionId) onSessionReady?.(data.sessionId);
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

      if (response.type === 'purchase_success') {
        toast.success('Purchase confirmed on Stellar!');
        onWalletChanged?.();
      } else if (response.type === 'purchase_failed') {
        toast.error('Payment failed: ' + (response.metadata?.error || 'Unknown error'));
      } else if (response.type === 'purchase_pending') {
        onWalletChanged?.();
      }
    } catch (err) {
      const retryAfter = Number.parseInt(err.response?.headers?.['retry-after'] || err.response?.data?.retryAfterSeconds, 10);
      const errorMsg = err.response?.status === 429 && Number.isFinite(retryAfter)
        ? `You have sent messages quickly. Please try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`
        : (err.response?.data?.error || 'Something went wrong. Please try again.');
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'agent',
        content: errorMsg,
        created_at: new Date().toISOString(),
      }]);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, toast, sessionId, onSessionReady, onWalletChanged]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleConfirmPurchase = (purchaseIntentId) => {
    sendMessage(`Confirm purchase ${purchaseIntentId}`);
  };

  const handleSkip = () => {
    sendMessage('Cancel purchase');
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
              onConfirm={() => handleConfirmPurchase(msg.metadata.purchaseIntentId)}
              onSkip={handleSkip}
              historical={msg.historical}
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
              <XCircle size={16} weight="fill" style={{ marginRight: 6 }} /> Payment Failed
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
              <Hourglass size={16} weight="fill" style={{ marginRight: 6, color: 'var(--color-warning)' }} /> Purchase Pending
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
            <img src="/logo.svg" alt="JarvisPayz Logo" style={{ width: 22, height: 22, marginRight: 8, display: 'block' }} />
            <h2>JarvisPayz Agent</h2>
          </div>
        </div>
        <div className="chat-messages" style={{ alignItems: 'center', justifyContent: 'center' }} aria-live="polite" aria-label="Shopping conversation">
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
          <img src="/logo.svg" alt="JarvisPayz Logo" style={{ width: 26, height: 26, marginRight: 8, display: 'block' }} />
          <div>
            <h2>JarvisPayz Agent</h2>
            <div className="chat-header-status">Online</div>
          </div>
        </div>
        <div className="chat-header-actions">
          <button
            className={`chat-telemetry-toggle ${telemetryOpen ? 'active' : ''}`}
            onClick={onToggleTelemetry}
            title="Toggle Status & Safeguards Dashboard"
            aria-label="Toggle wallet and safeguards panel"
            aria-pressed={telemetryOpen}
          >
            <Sliders size={18} weight="bold" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages" aria-live="polite" aria-label="Shopping conversation">
        {messages.length === 0 ? (
          <div className="chat-messages-empty">
            <div className="chat-empty-icon">
              <ShoppingBagOpen size={48} weight="duotone" color="var(--color-primary)" />
            </div>
            <h3>What would you like to buy?</h3>
            <p>
              Tell me what you're looking for and I'll find the best option
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
            aria-label="Tell the agent what you want to buy"
          />
          <button
            className="chat-send-btn"
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            id="chat-send-btn"
            aria-label="Send message"
          >
            <PaperPlaneRight size={16} weight="fill" />
          </button>
        </div>
        <div className="chat-input-hint">
          Press Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
