import HaccpService from '../services/haccpService.js';
import { sendResponse } from '../utils/apiResponse.js';

class HaccpController {
  static async getKpi(req, res, next) {
    try {
      const uptParam = req.query.kd_unit || req.query.id_upt;
      const data = await HaccpService.getKpi({ ...req.query, upt: uptParam, kdUnit: req.query.kd_unit, idUpt: req.query.id_upt });
      return sendResponse(res, 200, 'KPI HACCP berhasil dimuat', data);
    } catch (error) {
      return next(error);
    }
  }

  static async getCharts(req, res, next) {
    try {
      const uptParam = req.query.kd_unit || req.query.id_upt;
      const data = await HaccpService.getCharts({ ...req.query, upt: uptParam });
      return sendResponse(res, 200, 'Chart HACCP berhasil dimuat', data);
    } catch (error) {
      return next(error);
    }
  }

  static async getTable(req, res, next) {
    try {
      const uptParam = req.query.kd_unit || req.query.id_upt;
      const result = await HaccpService.getTable({ ...req.query, upt: uptParam });
      return sendResponse(res, 200, 'Data tabel HACCP berhasil dimuat', result.data, { pagination: result.pagination });
    } catch (error) {
      return next(error);
    }
  }
}

export default HaccpController;
