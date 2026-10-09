import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { allowRoles } from '../middleware/roleMiddleware.js';
import PrimerController from '../controllers/primerController.js';

const router = Router();

/**
 * Rute modul Primer, dipasang pada prefix `/api/v1/primer`.
 *
 * Guard dipasang dengan `router.use` supaya berlaku untuk seluruh endpoint di
 * bawah ini tanpa perlu mengulanginya per rute. Urutannya penting:
 * `verifyToken` lebih dulu karena `allowRoles` membaca `req.user` yang
 * diisi olehnya. Bila dibalik, setiap permintaan akan berakhir 401.
 *
 * Hanya Role 1 (Administrator) dan Role 2 (Executive) yang diizinkan. Role
 * lain, termasuk role yang punya akses nasional seperti Role 6, tetap
 * ditolak dengan 403 — ini lapisan kedua, login juga sudah membatasi role.
 */
router.use(verifyToken, allowRoles([1, 2]));

/**
 * GET /api/v1/primer/overview
 * Ringkasan KPI, tren bulanan per 12 bulan, distribusi provinsi & komoditas.
 */
router.get('/overview', PrimerController.getOverview);

/**
 * GET /api/v1/primer/certificates
 * Data tabel sertifikat dengan pagination.
 * Query: `page`, `limit`, `startDate`, `endDate`, `kdIzin`, `kdDaerah`,
 *        `search`, `sortBy`, `sortOrder`.
 */
router.get('/certificates', PrimerController.getCertificates);

/**
 * GET /api/v1/primer/export
 * Unduh dataset sertifikat sebagai CSV, memakai filter yang sama dengan
 * endpoint `certificates`.
 */
router.get('/export', PrimerController.exportCertificates);

export default router;
