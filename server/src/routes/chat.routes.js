import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { processMessage, getOrCreateSession, getSessionMessages, listSessions, createSession, getSessionForUser, archiveSession, renameSession } from '../services/agent.service.js';
import { validateChatMessage } from '../services/validation.service.js';
import { chatMessageLimiter, chatReadLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * POST /api/chat/message
 * Body: { message: "buy me earbuds" }
 * Returns: agent response with product cards, text, etc.
 */
router.post('/message', authenticate, chatMessageLimiter, async (req, res) => {
  try {
    const { message } = req.body;

    const cleanMessage = validateChatMessage(message);

    // Get or create session
    const session = req.body?.sessionId ? await getSessionForUser(req.user.userId, req.body.sessionId) : await getOrCreateSession(req.user.userId);
    if (!session) return res.status(404).json({ error: 'Chat session not found' });

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
router.get('/history', authenticate, chatReadLimiter, async (req, res) => {
  try {
    const session = req.query.sessionId ? await getSessionForUser(req.user.userId, req.query.sessionId) : await getOrCreateSession(req.user.userId);
    if (!session) return res.status(404).json({ error: 'Chat session not found' });
    const messages = await getSessionMessages(session.id);

    // Parse metadata JSON for each message
    const parsed = messages.map(msg => ({
      ...msg,
      metadata: msg.metadata ? (typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata) : null,
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
router.get('/sessions', authenticate, chatReadLimiter, async (req,res,next) => { try { res.json({ sessions: await listSessions(req.user.userId) }); } catch (error) { next(error); } });
router.post('/sessions', authenticate, chatReadLimiter, async (req,res,next) => { try { const session = req.body?.reuseBlank ? await getOrCreateSession(req.user.userId) : await createSession(req.user.userId); res.status(201).json({ session }); } catch (error) { next(error); } });
router.patch('/sessions/:id', authenticate, chatReadLimiter, async (req, res, next) => { try { const session = await renameSession(req.user.userId, req.params.id, req.body?.title); if (!session) return res.status(404).json({ error: 'Chat session not found' }); res.json({ session }); } catch (error) { if (error.message === 'Chat name is required') return res.status(400).json({ error: error.message }); next(error); } });
router.delete('/sessions/:id', authenticate, chatReadLimiter, async (req, res, next) => { try { const session = await archiveSession(req.user.userId, req.params.id); if (!session) return res.status(404).json({ error: 'Chat session not found' }); res.json({ success: true }); } catch (error) { next(error); } });

export default router;
