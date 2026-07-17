import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { processMessage, getOrCreateSession, getSessionMessages } from '../services/agent.service.js';
import { validateChatMessage } from '../services/validation.service.js';

const router = Router();

/**
 * POST /api/chat/message
 * Body: { message: "buy me earbuds" }
 * Returns: agent response with product cards, text, etc.
 */
router.post('/message', authenticate, async (req, res) => {
  try {
    const { message } = req.body;

    const cleanMessage = validateChatMessage(message);

    // Get or create session
    const session = getOrCreateSession(req.user.userId);

    // Process through the agent
    const response = await processMessage(req.user.userId, session.id, cleanMessage, req.user.googleSub);

    res.json({
      sessionId: session.id,
      response,
    });
  } catch (err) {
    console.error('❌ Chat error:', err.message);
    const badRequest = err.message.includes('Message');
    res.status(badRequest ? 400 : 500).json({ error: badRequest ? err.message : 'Failed to process message' });
  }
});

/**
 * GET /api/chat/history
 * Returns message history for the current session.
 */
router.get('/history', authenticate, (req, res) => {
  try {
    const session = getOrCreateSession(req.user.userId);
    const messages = getSessionMessages(session.id);

    // Parse metadata JSON for each message
    const parsed = messages.map(msg => ({
      ...msg,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
    }));

    res.json({
      sessionId: session.id,
      messages: parsed,
    });
  } catch (err) {
    console.error('❌ History error:', err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;
