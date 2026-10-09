import DashboardOverviewService from '../services/dashboardOverviewService.js';
import { sendResponse } from '../utils/apiResponse.js';

class DashboardOverviewController {
  static async getOverview(req, res, next) {
    try {
      const { startDate, endDate, uptId, kd_unit } = req.query;
      const effectiveUpt = uptId || kd_unit || null;
      const data = await DashboardOverviewService.getOverviewMetrics({
        startDate,
        endDate,
        uptId: effectiveUpt
      });
      return sendResponse(res, 200, 'Data ringkasan dashboard berhasil dimuat', data);
    } catch (error) {
      console.error('[DashboardOverview Error]:', error);
      return next(error);
    }
  }
}

export default DashboardOverviewController;
