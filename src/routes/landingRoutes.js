import { Router } from 'express';
import MapController from '../controllers/mapController.js';

const router = Router();

/**
 * Rute untuk landing page publik.
 *
 * Berbeda dengan modul lain (`options`, `smkhp`, `skp`, `primer`, `haccp`)
 * yang memasang `verifyToken`, modul ini sengaja TIDAK memakai middleware auth:
 * peta sebaran tampil di landing page sebelum pengunjung login. Rute yang
 * dilarang publik jangan ditambahkan di file ini tanpa menambahkan
 * `verifyToken` di level rutenya.
 */
router.get('/peta-sebar', MapController.getPetaSebaran);

/**
 * GET /api/v1/landing/upt-marker
 * Titik lokasi UPT aktif untuk marker peta. Publik, menemani `peta-sebar`.
 */
router.get('/upt-marker', MapController.getUptMarkers);

export default router;
