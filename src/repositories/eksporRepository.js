import { QueryTypes } from 'sequelize';
import { dbReport } from '../config/database.js';

const TABEL = 'tr_report_ekspor';

function buildWhere({ startDate, endDate, uptId }, r) {
  const w = [];
  if (startDate) {
    w.push('tanggal_smkhp BETWEEN :startDate AND :endDate');
    r.startDate = startDate;
    r.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
  } else if (endDate) {
    w.push('tanggal_smkhp <= :endDate');
    r.endDate = `${endDate} 23:59:59`;
  }
  const uptVal = uptId;
  if (uptVal) {
    w.push('(kode_upt = :upt OR nama_upt = :upt)');
    r.upt = uptVal;
  }
  return w.length ? `WHERE ${w.join(' AND ')}` : '';
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

  static async getMonthlyTrends({ startDate, endDate, uptId } = {}) {
    const r = {};
    const w = [];
    if (startDate) {
      w.push('tanggal_smkhp BETWEEN :startDate AND :endDate');
      r.startDate = startDate;
      r.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
    } else if (endDate) {
      w.push('tanggal_smkhp <= :endDate');
      r.endDate = `${endDate} 23:59:59`;
    }
    if (uptId) {
      w.push('(kode_upt = :upt OR nama_upt = :upt)');
      r.upt = uptId;
    }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const rows = await dbReport.query(
      `SELECT MONTH(tanggal_smkhp) AS m, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
       GROUP BY m
       ORDER BY m`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ month: Number(x.m), total: Number(x.total) }));
  }

  static async getByUpt({ startDate, endDate, uptId } = {}) {
    const r = {};
    const w = [];
    if (startDate) {
      w.push('tanggal_smkhp BETWEEN :startDate AND :endDate');
      r.startDate = startDate;
      r.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
    } else if (endDate) {
      w.push('tanggal_smkhp <= :endDate');
      r.endDate = `${endDate} 23:59:59`;
    }
    if (uptId) {
      w.push('(kode_upt = :upt OR nama_upt = :upt)');
      r.upt = uptId;
    }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const rows = await dbReport.query(
      `SELECT COALESCE(NULLIF(TRIM(nama_upt), ''), 'Tidak Diketahui') AS namaUpt, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
       GROUP BY nama_upt
       ORDER BY total DESC
       LIMIT 10`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ namaUpt: x.namaUpt, total: Number(x.total) }));
  }

  static async getRecentActivities({ startDate, endDate, uptId } = {}) {
    const r = {};
    const w = [];
    if (startDate) {
      w.push('tanggal_smkhp BETWEEN :startDate AND :endDate');
      r.startDate = startDate;
      r.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
    } else if (endDate) {
      w.push('tanggal_smkhp <= :endDate');
      r.endDate = `${endDate} 23:59:59`;
    }
    if (uptId) {
      w.push('(kode_upt = :upt OR nama_upt = :upt)');
      r.upt = uptId;
    }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const rows = await dbReport.query(
      `SELECT nomor_aju, nama_trader AS applicant, nama_upt, tanggal_smkhp AS date, 'SUBMITTED' AS status
       FROM ${TABEL}
       ${where}
       ORDER BY tanggal_smkhp DESC
       LIMIT 10`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map((x, i) => ({
      id: x.nomor_aju || i,
      module: 'Ekspor',
      serviceName: 'Ekspor',
      applicant: x.applicant,
      upt: x.nama_upt,
      date: x.date,
      status: x.status
    }));
  }

}

export default EksporRepository;
