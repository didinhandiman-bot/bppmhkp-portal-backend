import { Router } from 'express';
import HaccpController from '../controllers/haccpController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = Router();
router.use(verifyToken);

router.get('/kpi', HaccpController.getKpi);
router.get('/charts', HaccpController.getCharts);
router.get('/table', HaccpController.getTable);

export default router;
