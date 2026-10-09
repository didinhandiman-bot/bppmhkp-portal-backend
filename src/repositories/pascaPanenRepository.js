import { QueryTypes } from 'sequelize';
import { dbReportSkp, dbReport, dbHaccp } from '../config/database.js';

class PascaPanenRepository {
  static async getAggregatedSummary({ startDate, endDate, uptId } = {}) {
    const r = {};
    const wSkp = [];
    if (startDate) {
      wSkp.push('tanggal_terbit BETWEEN :startDate AND :endDate');
      r.startDate = startDate;
      r.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
    } else if (endDate) {
      wSkp.push('tanggal_terbit <= :endDate');
      r.endDate = `${endDate} 23:59:59`;
    }
    if (uptId) {
      wSkp.push('(kode_upt = :upt OR nama_upt = :upt OR kd_unit = :upt)');
      r.upt = uptId;
    }
    const whereSkp = wSkp.length ? `WHERE ${wSkp.join(' AND ')}` : '';

    const skpRows = await dbReportSkp.query(
      `SELECT
         COUNT(*) AS totalSkp,
         0 AS skpBerlaku
       FROM tb_skp_paska
       ${whereSkp}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const wSmkhp = [];
    if (startDate) {
      wSmkhp.push('tanggal_smkhp BETWEEN :startDate AND :endDate');
    } else if (endDate) {
      wSmkhp.push('tanggal_smkhp <= :endDate');
    }
    if (uptId) {
      wSmkhp.push('(kode_upt = :upt OR nama_upt = :upt)');
    }
    const whereSmkhp = wSmkhp.length ? `WHERE ${wSmkhp.join(' AND ')}` : '';

    const smkhpRows = await dbReport.query(
      `SELECT COUNT(*) AS totalSmkhp
       FROM tr_report_ekspor
       ${whereSmkhp}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const wHaccp = [];
    if (startDate) {
      wHaccp.push('tgl_terbit BETWEEN :startDate AND :endDate');
    } else if (endDate) {
      wHaccp.push('tgl_terbit <= :endDate');
    }
    if (uptId) {
      wHaccp.push('(kd_unit = :upt OR id_upt = :upt OR upt = :upt)');
    }
    const whereHaccp = wHaccp.length ? `WHERE ${wHaccp.join(' AND ')}` : '';

    const haccpRows = await dbHaccp.query(
      `SELECT
         COUNT(*) AS totalHaccp,
         COUNT(CASE WHEN status_sert = 'BERLAKU' THEN 1 END) AS haccpBerlaku
       FROM vw07_sertifikasi
       ${whereHaccp}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const skp = skpRows[0] ?? {};
    const smkhp = smkhpRows[0] ?? {};
    const haccp = haccpRows[0] ?? {};

    const totalTerbit = Number(skp.totalSkp ?? 0) + Number(smkhp.totalSmkhp ?? 0) + Number(haccp.totalHaccp ?? 0);

    return {
      totalSertifikatTerbit: totalTerbit,
      smkhp: { total: Number(smkhp.totalSmkhp ?? 0) },
      skp: { total: Number(skp.totalSkp ?? 0), berlaku: Number(skp.skpBerlaku ?? 0) },
      haccp: { total: Number(haccp.totalHaccp ?? 0), berlaku: Number(haccp.haccpBerlaku ?? 0) },
      totalPending: 0,
      totalInProgress: 0
    };
  }

  static async getMonthlyTrends({ startDate, endDate, uptId } = {}) {
    const trends = Array(12).fill().map((_, i) => ({ month: i + 1, total: 0 }));
    return trends;
  }

  static async getByUpt({ startDate, endDate, uptId } = {}) {
    return [];
  }

  static async getRecentActivities({ startDate, endDate, uptId } = {}) {
    return [];
  }

}

export default PascaPanenRepository;
