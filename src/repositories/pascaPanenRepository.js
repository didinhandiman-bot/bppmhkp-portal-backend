import DashboardAnalyticsRepository from './dashboardAnalyticsRepository.js';
const SOURCES = ['ekspor', 'skp', 'haccp'];
export default class PascaPanenRepository {
  static async getAggregatedSummary(filters = {}) {
    const [smkhpRows, skpRows, haccpRows] = await Promise.all(SOURCES.map(source => DashboardAnalyticsRepository.read(source, 'summary', filters)));
    const smkhp = Number(smkhpRows[0]?.total || 0), skp = Number(skpRows[0]?.total || 0), haccp = Number(haccpRows[0]?.total || 0);
    return { totalSertifikatTerbit: smkhp + skp + haccp, smkhp: {total:smkhp}, skp:{total:skp, berlaku:Number(skpRows[0]?.berlaku || 0)}, haccp:{total:haccp, berlaku:Number(haccpRows[0]?.berlaku || 0)}, totalPending:0, totalInProgress:0 };
  }
  static async readAll(mode, filters) { return (await Promise.all(SOURCES.map(source => DashboardAnalyticsRepository.read(source, mode, filters)))).flat(); }
  static getMonthlyTrends(filters = {}) { return this.readAll('monthly', filters); }
  static getByUpt(filters = {}) { return this.readAll('distribution', filters); }
  static getRecentActivities(filters = {}) { return this.readAll('activities', filters); }
}
