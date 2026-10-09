import { Router } from 'express';
import HaccpController from '../controllers/haccpController.js';

const router = Router();

router.get('/kpi', HaccpController.getKpi);
router.get('/charts', HaccpController.getCharts);
router.get('/table', HaccpController.getTable);

export default router;
