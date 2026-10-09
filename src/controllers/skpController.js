import SkpService from '../services/skpService.js';

/**
 * Controller Modul SKP (Sertifikasi Kelayakan Pengolahan) - Pasca Panen.
 *
 * Tiap handler melempar galat ke `next(error)` agar ditangani satu kali oleh
 * `errorHandler` global di `app.js`. Envelope sukses memakai `{ success, message, data }`
 * yang sama dengan modul `smkhp`; galat mengikuti bentuk `{ success, message, error }`
 * dari `errorHandler`.
 */
class SkpController {
  /**
   * GET /api/v1/skp/summary
   * Metrik ringkasan: total SKP terbit, YoY, status aktif/expired, dan jumlah UPI.
   * Query params: year, provinsiId, skalaUsaha, peringkat.
   */
  static async getSummary(req, res, next) {
    try {
      const data = await SkpService.getSummaryMetrics(req.query);

      return res.status(200).json({
        success: true,
        message: 'Ringkasan SKP berhasil diambil.',
        data,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/skp/trends
   * Deret waktu 12 bulan beserta pembanding tahun sebelumnya.
   * Query params: year, provinsiId.
   */
  static async getTrends(req, res, next) {
    try {
      const data = await SkpService.getMonthlyTrends(req.query);

      return res.status(200).json({
        success: true,
        message: 'Tren bulanan SKP berhasil diambil.',
        data,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/skp/distribution
   * Distribusi peringkat, skala usaha, jenis pengolahan, dan wilayah.
   * Query params: year, provinsiId.
   */
  static async getDistribution(req, res, next) {
    try {
      const data = await SkpService.getDistribution(req.query);

      return res.status(200).json({
        success: true,
        message: 'Distribusi SKP berhasil diambil.',
        data,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/skp/list
   * Daftar SKP berpaginasi dengan pencarian dan filter.
   * Query params: page, limit, search, year, provinsiId, skalaUsaha,
   * peringkat, status, sortBy, sortOrder.
   */
  static async getList(req, res, next) {
    try {
      const result = await SkpService.getTableList(req.query);

      return res.status(200).json({
        success: true,
        message: 'Daftar SKP berhasil diambil.',
        data: result.data,
        meta: {
          pagination: result.pagination,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
}

export default SkpController;
