import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { allowRoles } from '../middleware/roleMiddleware.js';
import SkpController from '../controllers/skpController.js';

const router = Router();

/**
 * Role yang boleh mengakses Modul SKP.
 * 1 = Administrator, 2 = Admin UPT.
 *
 * `verifyToken` dipasang lebih dulu supaya `req.user` terisi, baru `allowRoles`
 * memeriksa claim role di dalamnya. Urutan ini penting: membalik keduanya akan
 * membuat `allowRoles` selalu menolak karena token belum diverifikasi.
 */
const ROLES_SKP = [1, 2];

router.use(verifyToken);
router.use(allowRoles(ROLES_SKP));

/**
 * GET /api/v1/skp/summary
 * Metrik ringkasan SKP: total terbit, YoY, status aktif/expired, jumlah UPI.
 * Query params: year, provinsiId, skalaUsaha, peringkat.
 */
router.get('/summary', SkpController.getSummary);

/**
 * GET /api/v1/skp/trends
 * Deret waktu 12 bulan + pembanding tahun sebelumnya.
 * Query params: year, provinsiId.
 */
router.get('/trends', SkpController.getTrends);

/**
 * GET /api/v1/skp/distribution
 * Distribusi peringkat, skala usaha, jenis pengolahan, dan wilayah.
 * Query params: year, provinsiId.
 */
router.get('/distribution', SkpController.getDistribution);

/**
 * GET /api/v1/skp/list
 * Daftar SKP berpaginasi dengan pencarian bebas dan filter status.
 * Query params: page, limit, search, year, provinsiId, skalaUsaha,
 * peringkat, status (aktif|expired|expiring_soon), sortBy, sortOrder.
 */
router.get('/list', SkpController.getList);

export default router;
