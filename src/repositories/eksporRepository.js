import { literal } from 'sequelize';
import { ReportEksport } from '../models/index.js';
import DashboardAnalyticsRepository from './dashboardAnalyticsRepository.js';
import ExportRepository from './smkhpRepository.js';

class EksporRepository {
  /**
   * Agregat ringkasan ekspor untuk dashboard overview.
   *
   * Model-First Standard: dibaca lewat `ReportEksport.findAll` dengan atribut
   * `[literal(...), alias]` + `raw: true`. Kondisi filter berasal dari
   * `ExportRepository.buildWhereClause()` (tanpa kata kunci `WHERE`), sehingga
   * logika UPT/tanggal tetap identik dengan modul SMKHP.
   */
  static async getAggregatedSummary({ startDate, endDate, uptId } = {}) {
    const { conditions, replacements } = ExportRepository.buildWhereClause({
      startDate,
      endDate,
      kd_upt: uptId,
    });

    const rows = await ReportEksport.findAll({
      attributes: [
        [literal('COUNT(*)'), 'totalFrekuensi'],
        [literal('COUNT(DISTINCT nomor_aju)'), 'totalPengajuan'],
        [literal('SUM(COALESCE(netto, 0))'), 'totalVolumeKg'],
        [literal('SUM(COALESCE(nilai_rupiah, 0))'), 'totalNilaiRupiah'],
      ],
      ...(conditions.length ? { where: literal(conditions.join(' AND ')) } : {}),
      replacements,
      raw: true,
    });

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
