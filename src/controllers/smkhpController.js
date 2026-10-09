import ExportService from '../services/smkhpService.js';
import ExportMatrixService from '../services/smkhpMatrixService.js';
import { sendResponse } from '../utils/apiResponse.js';

class ExportController {

  /**
   * Menyusun objek filter dari query string.
   *
   * - `startDate` & `endDate`: rentang tanggal berangkat (YYYY-MM-DD).
   * - `kd_upt`: kode UPT (opsional). Nilai `01.00` dinormalkan menjadi
   *   `15.0`; filter `15.0` sekaligus menjangkau baris `01.00`/`01.0`.
   * - `upt`: nama UPT (opsional, kompatibilitas frontend lama). Diabaikan
   *   bila `kd_upt` sudah diberikan.
   * - `negara_tujuan`: nama negara tujuan (opsional).
   */
  static #buildFilters(req) {
    const kdUpt = req.query.kd_upt ?? req.query.kode_upt ?? req.query.upt_kode;

    return {
      startDate: req.query.startDate || undefined,
      endDate: req.query.endDate || undefined,
      kd_upt: kdUpt || undefined,
      upt: kdUpt ? undefined : req.query.upt || undefined,
      negara_tujuan: req.query.negara_tujuan || undefined,
    };
  }

  /**
   * GET KPI Summary
   */
  static async getKpiSummary(req, res, next) {
    try {
      const data = await ExportService.getKpiSummary(ExportController.#buildFilters(req));

      return sendResponse(res, 200, 'KPI summary berhasil diambil.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET Monthly Trends
   */
  static async getMonthlyTrends(req, res, next) {
    try {
      const data = await ExportService.getMonthlyTrends(ExportController.#buildFilters(req));

      return sendResponse(res, 200, 'Tren bulanan berhasil diambil.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET Top Destinations
   */
  static async getTopDestinations(req, res, next) {
    try {
      const limit = parseInt(req.query.limit, 10) || 5;

      const data = await ExportService.getTopDestinations(
        ExportController.#buildFilters(req),
        limit,
      );

      return sendResponse(res, 200, 'Negara tujuan ekspor terbesar berhasil diambil.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET Commodity Analytics
   */
  static async getCommodityAnalytics(req, res, next) {
    try {
      const data = await ExportService.getCommodityAnalytics(ExportController.#buildFilters(req));

      return sendResponse(res, 200, 'Analisis komoditas berhasil diambil.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET UPT list (legacy, dari tabel transaksi)
   */
  static async getUpts(req, res, next) {
    try {
      const data = await ExportService.getUpts();

      return sendResponse(res, 200, 'Daftar UPT berhasil diambil.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET Rekap kontribusi per UPT
   */
  static async getUptBreakdown(req, res, next) {
    try {
      const data = await ExportService.getUptBreakdown(ExportController.#buildFilters(req));

      return sendResponse(res, 200, 'Rekap kontribusi per UPT berhasil diambil.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Menyusun filter untuk endpoint matriks ekspor.
   *
   * Menambah `tahun`/`bulan` pada filter umum (`#buildFilters`). Bila
   * `startDate`/`endDate` tidak diberikan, rentang diselesaikan oleh
   * `ExportMatrixService.resolvePeriod` (prioritas tahun/bulan, lalu default
   * YTD berjalan). `negara_tujuan` tetap dipakai sebagai filter mentah ketika
   * hanya menelusuri satu negara.
   */
  static #buildMatrixFilters(req) {
    return {
      ...ExportController.#buildFilters(req),
      tahun: req.query.tahun || undefined,
      bulan: req.query.bulan || undefined,
    };
  }

  /**
   * GET Tampilan 1 Matriks: Produk Utama di Negara Tujuan
   */
  static async getTopProductsByDestination(req, res, next) {
    try {
      const data = await ExportMatrixService.getMatrixTopProductsByDestination(
        ExportController.#buildMatrixFilters(req),
        { productsLimit: parseInt(req.query.products, 10) || undefined }
      );

      return sendResponse(res, 200, 'Matriks produk utama per negara tujuan berhasil diambil.', {
        destinations: data.destinations,
        periode: data.periode,
        previousPeriode: data.previousPeriode,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET Tampilan 2 Matriks: Pasar Utama per Produk
   */
  static async getTopDestinationsByProduct(req, res, next) {
    try {
      const data = await ExportMatrixService.getMatrixTopDestinationsByProduct(
        ExportController.#buildMatrixFilters(req),
        {
          productsLimit: parseInt(req.query.products, 10) || undefined,
          destinationsLimit: parseInt(req.query.destinations, 10) || undefined,
        }
      );

      return sendResponse(res, 200, 'Matriks pasar utama per produk berhasil diambil.', {
        products: data.products,
        periode: data.periode,
        previousPeriode: data.previousPeriode,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET Transactions (paginated + searchable)
   */
  static async getTransactions(req, res, next) {
    try {
      const pagination = {
        page: Math.max(1, parseInt(req.query.page, 10) || 1),
        limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10)),
        search: req.query.search || '',
      };

      const result = await ExportService.getTransactions(
        ExportController.#buildFilters(req),
        pagination,
      );

      return sendResponse(res, 200, 'Daftar transaksi berhasil diambil.', result.data, result.meta);
    } catch (error) {
      next(error);
    }
  }
}

export default ExportController;
