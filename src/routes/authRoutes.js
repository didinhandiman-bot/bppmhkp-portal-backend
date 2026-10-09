import express from 'express';
import authController from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/login', (req, res) => authController.login(req, res));
router.get('/me', verifyToken, (req, res) => authController.me(req, res));

export default router;
