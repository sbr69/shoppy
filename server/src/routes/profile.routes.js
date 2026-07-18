import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getProfile, saveProfile } from '../services/profile.service.js';

const router = Router();
router.get('/', authenticate, async (req, res, next) => { try { res.json(await getProfile(req.user.userId)); } catch (error) { next(error); } });
router.put('/', authenticate, async (req, res, next) => { try { res.json(await saveProfile(req.user.userId, req.body || {})); } catch (error) { res.status(400).json({ error: error.message }); } });
export default router;
