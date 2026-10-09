import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import ExportController from '../controllers/smkhpController.js';

const router = Router();

// Semua route di bawah ini membutuhkan token autentikasi
router.use(verifyToken);

/**
 * GET /api/v1/exports/kpi-summary
 * Hero metric & KPI Cards dashboard
 */
router.get('/kpi-summary', ExportController.getKpiSummary);

/**
 * GET /api/v1/exports/monthly-trends
 * Tren pergerakan bulanan
 */
router.get('/monthly-trends', ExportController.getMonthlyTrends);

/**
 * GET /api/v1/exports/top-destinations
 * Negara tujuan ekspor terbesar (opsional ?limit=5)
 */
router.get('/top-destinations', ExportController.getTopDestinations);

/**
 * GET /api/v1/exports/commodity-analytics
 * Analisis komoditas: tawar/laut, konsumsi, top kel_ikan
 */
router.get('/commodity-analytics', ExportController.getCommodityAnalytics);

/**
 * GET /api/v1/exports/upts
 * Daftar DISTINCT nama UPT dari tabel transaksi (kompatibilitas frontend lama).
 * Opsi dropdown yang baru: GET /api/v1/options/upt
 */
router.get('/upts', ExportController.getUpts);

/**
 * GET /api/v1/exports/upt-breakdown
 * Rekap kontribusi per UPT; bucket 01.00 & 15.0 digabung menjadi 15.0
 * Query params: startDate, endDate, kd_upt, negara_tujuan
 */
router.get('/upt-breakdown', ExportController.getUptBreakdown);

/**
 * GET /api/v1/exports/top-products-by-destination
 * Tampilan 1 Matriks: Produk Utama di Negara Tujuan.
 * 5 destinasi utama (Amerika Serikat, Tiongkok, ASEAN, Jepang, Uni Eropa),
 * masing-masing berisi nilai USD Juta, YoY, share nasional, dan top produk.
 * Query params: startDate/endDate | tahun (+bulan); opsional kd_upt, products.
 */
router.get('/top-products-by-destination', ExportController.getTopProductsByDestination);

/**
 * GET /api/v1/exports/top-destinations-by-product
 * Tampilan 2 Matriks: Pasar Utama per Produk.
 * Komoditas utama (Udang, Tuna-Cakalang, Cumi-Sotong-Gurita, Rajungan-Kepiting,
 * Rumput Laut, dsb.), masing-masing berisi nilai USD Juta, YoY, share nasional,
 * dan 5 negara tujuan teratas.
 * Query params: startDate/endDate | tahun (+bulan); opsional kd_upt, products, destinations.
 */
router.get('/top-destinations-by-product', ExportController.getTopDestinationsByProduct);

/**
 * GET /api/v1/exports/transactions
 * Daftar log pengajuan dengan paginasi & pencarian
 * Query params: page, limit, search, startDate, endDate, kd_upt, negara_tujuan
 */
router.get('/transactions', ExportController.getTransactions);

export default router;
