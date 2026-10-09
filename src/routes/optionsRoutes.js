import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import OptionsController from '../controllers/optionsController.js';

const router = Router();

/**
 * Endpoint di bawah ini adalah data master yang dipakai untuk mengisi filter
 * di seluruh halaman laporan, sehingga dilindungi token sama seperti endpoint
 * `smkhp`. Master's cache juga sudah ter-preload saat boot, jadi tidak ada
 * alasan untuk membukanya ke publik.
 */
router.use(verifyToken);

/**
 * GET /api/v1/options/upt
 * Opsi dropdown UPT dari master `hc.tb_r_upt` (aktif, bukan unit uji).
 * Bentuk item: `{ value, label, kota }`.
 */
router.get('/upt', OptionsController.getUptOptions);

export default router;