import DashboardAnalyticsRepository from './dashboardAnalyticsRepository.js';
import ExportRepository from './smkhpRepository.js';
import { QueryTypes } from 'sequelize';
import { dbReport } from '../config/database.js';

const TABEL = 'tr_report_ekspor';

function buildWhere({ startDate, endDate, uptId }, r) {
  const { whereStr, replacements } = ExportRepository.buildWhereClause({ startDate, endDate, kd_upt: uptId });
  Object.assign(r, replacements);
  return whereStr;
}

class EksporRepository {
  static async getAggregatedSummary({ startDate, endDate, uptId } = {}) {
    const r = {};
    const where = buildWhere({ startDate, endDate, uptId }, r);
    const rows = await dbReport.query(
      `SELECT
         COUNT(*) AS totalFrekuensi,
         COUNT(DISTINCT nomor_aju) AS totalPengajuan,
         SUM(COALESCE(netto, 0)) AS totalVolumeKg,
         SUM(COALESCE(nilai_rupiah, 0)) AS totalNilaiRupiah
       FROM ${TABEL}
       ${where}`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    const row = rows[0] ?? {};
    const totalVolumeKg = Number(row.totalVolumeKg ?? 0);
    return {
      totalFrekuensi: Number(row.totalFrekuensi ?? 0),
      totalPengajuan: Number(row.totalPengajuan ?? 0),
      totalVolumeKg,
      totalVolumeTon: totalVolumeKg / 1000,
      totalNilaiRupiah: Number(row.totalNilaiRupiah ?? 0)
    };
  }

  static getMonthlyTrends(filters = {}) { return DashboardAnalyticsRepository.read('ekspor', 'monthly', filters); }
  static getByUpt(filters = {}) { return DashboardAnalyticsRepository.read('ekspor', 'distribution', filters); }
  static getRecentActivities(filters = {}) { return DashboardAnalyticsRepository.read('ekspor', 'activities', filters); }
}
export default EksporRepository;
