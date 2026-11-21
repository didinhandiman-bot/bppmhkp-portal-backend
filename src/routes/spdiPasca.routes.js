import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { allowRoles } from '../middleware/roleMiddleware.js';
import SpdiPascaController from '../controllers/spdiPasca.controller.js';

const router = Router();

/**
 * Rute modul SPDI Pascapanen, dipasang pada prefix `/api/v1/pascapanen/spdi`
 * lewat `src/routes/index.js`.
 *
 * Guard dipasang dengan `router.use` supaya berlaku untuk seluruh endpoint di
 * bawahnya tanpa diulang per rute. Urutannya penting: `verifyToken` lebih dulu
 * karena `allowRoles` membaca `req.user` yang diisi olehnya — dibalik akan
 * membuat setiap permintaan berakhir 401/403.
 *
 * Role 1 (Administrator) dan 2 (Admin UPT) saja, mengikuti `skp` dan `primer`.
 * Pembatasan wilayah per UPT ditegakkan di controller lewat `scopedUptQuery`.
 */
router.use(verifyToken, allowRoles([1, 2]));

/**
 * GET /api/v1/pascapanen/spdi/dashboard
 * Ringkasan dashboard: KPI, tren bulanan terbit, kontribusi UPT, sebaran
 * provinsi (GeoJSON), dan distribusi KBLI (Donut Chart).
 * Query params: kd_upt, kd_provinsi, tahun.
 */
router.get('/dashboard', SpdiPascaController.getDashboard);

/**
 * GET /api/v1/pascapanen/spdi/list
 * Daftar unit dengan pagination dan pencarian `nama_unit`/`nomor_sertifikat`.
 * Query params: page, limit, search, kd_upt, kd_provinsi, tahun.
 */
router.get('/list', SpdiPascaController.getList);

export default router;
