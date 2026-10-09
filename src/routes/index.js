import { Router } from 'express';

import authRoutes from './authRoutes.js';
import optionsRoutes from './optionsRoutes.js';
import smkhpRoutes from './smkhpRoutes.js';
import skpRoutes from './skpRoutes.js';
import primerRoutes from './primerRoutes.js';
import haccpRoutes from './haccpRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';

/**
 * Agregator seluruh rute API versi 1.
 *
 * Dipasang satu kali di `src/app.js` pada prefix `/api/v1`, jadi setiap modul
 * cukup terdaftar di sini dan tidak perlu mounting manual di `app.js`.
 *
 * Arsitektur proyek memakai TECHNICAL LAYERING di root `src/`: seluruh
 * controller ada di `src/controllers/`, service di `src/services/`,
 * repository di `src/repositories/`, dan router modul di `src/routes/`.
 * `*Routes.js` tying langsung ke controller pada folder yang sama, sehingga
 * tidak ada lompatan antar-layer di dalam satu modul.
 */
const router = Router();

router.use('/auth', authRoutes);
router.use('/options', optionsRoutes);
router.use('/pascapanen/smkhp', smkhpRoutes);
router.use('/skp', skpRoutes);
router.use('/primer', primerRoutes);
router.use('/pasca-panen/haccp', haccpRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
