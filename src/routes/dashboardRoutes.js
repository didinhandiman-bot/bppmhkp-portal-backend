import { Router } from 'express';
import DashboardOverviewController from '../controllers/dashboardOverviewController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/overview', verifyToken, DashboardOverviewController.getOverview);

export default router;
