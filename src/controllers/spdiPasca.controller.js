import { scopedUptQuery } from '../utils/uptScope.js';
import SpdiPascaService from '../services/spdiPasca.service.js';
import { sendResponse } from '../utils/apiResponse.js';

/**
 * Controller Modul SPDI Pascapanen.
 *
 * HTTP masuk, envelope keluar — tidak ada logika lain di sini. Galat dilempar
 * ke `next(error)` agar ditangani satu kali oleh `errorHandler` global di
 * `app.js`; bentuknya `{ success: false, message }` (plus `error` hanya pada
 * NODE_ENV=development), sedangkan sukses memakai `{ success, message, data,
 * meta? }` dari `utils/apiResponse.js` — sama seperti modul HACCP.
 *
 * `scopedUptQuery` memaksa pembatasan wilayah dari klaim token, bukan dari
 * query string: pengguna non-nasional tidak bisa melebarkan aksesnya dengan
 * mengirim `kd_upt` milik unit lain.
 */
class SpdiPascaController {
  /**
   * GET /api/v1/pascapanen/spdi/dashboard
   * Metrik KPI, tren bulanan, kontribusi UPT, sebaran provinsi, dan distribusi KBLI.
   * Query params: kd_upt, kd_provinsi, tahun.
   */
  static async getDashboard(req, res, next) {
    try {
      const query = scopedUptQuery(req.user, req.query);
      const data = await SpdiPascaService.getDashboardData(query);

      return sendResponse(res, 200, 'Dashboard SPDI Pascapanen berhasil dimuat', data);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/pascapanen/spdi/list
   * Daftar unit SPDI berpaginasi dengan pencarian bebas.
   * Query params: page, limit, search, kd_upt, kd_provinsi, tahun.
   */
  static async getList(req, res, next) {
    try {
      const query = scopedUptQuery(req.user, req.query);
      const result = await SpdiPascaService.getUnitList(query);

      return sendResponse(res, 200, 'Daftar unit SPDI Pascapanen berhasil dimuat', result.data, result.meta);
    } catch (error) {
      return next(error);
    }
  }
}

export default SpdiPascaController;
