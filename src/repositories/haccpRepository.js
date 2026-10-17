import { QueryTypes } from 'sequelize';
import { dbHaccp } from '../config/database.js';

const VIEW = 'report_haccp.vw07_sertifikasi';

function buildWhere({ startDate, endDate, idUpt, upt, kdUnit, grade, statusSert, _uptRestricted }, replacements) {
  const w = [];
  if (startDate) {
    w.push('tgl_terbit BETWEEN :startDate AND :endDate');
    replacements.startDate = startDate;
    replacements.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
  } else if (endDate) {
    w.push('tgl_terbit <= :endDate');
    replacements.endDate = `${endDate} 23:59:59`;
  }
  const uptVal = upt || kdUnit || idUpt;
  if (uptVal) {
    w.push(_uptRestricted ? "kd_unit = :upt" : "(kd_unit = :upt OR id_upt = :upt)");
    replacements.upt = uptVal;
  }
  if (grade) {
    w.push('grade = :grade');
    replacements.grade = grade;
  }
  if (statusSert) {
    w.push("status_sert = :statusSert");
    replacements.statusSert = statusSert;
  }
  return w.length ? `WHERE ${w.join(' AND ')}` : '';
}

class HaccpRepository {
  static async getKpi(filters = {}) {
    const r = {};
    const where = buildWhere(filters, r);
    const rows = await dbHaccp.query(
      `SELECT
         COUNT(*) AS totalSertifikat,
         SUM(CASE WHEN status_sert = 'BERLAKU' THEN 1 ELSE 0 END) AS totalBerlaku,
         SUM(CASE WHEN status_sert = 'KADALUARSA' THEN 1 ELSE 0 END) AS totalKadaluarsa,
         COUNT(DISTINCT id_upi) AS totalUpi,
         AVG(CASE WHEN tgl_terima IS NOT NULL AND tgl_terbit IS NOT NULL THEN DATEDIFF(tgl_terbit, tgl_terima) ELSE NULL END) AS avgProsesHari
       FROM ${VIEW}
       ${where}`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    const row = rows[0] ?? {};
    return {
      totalSertifikat: Number(row.totalSertifikat ?? 0),
      totalBerlaku: Number(row.totalBerlaku ?? 0),
      totalKadaluarsa: Number(row.totalKadaluarsa ?? 0),
      totalUpi: Number(row.totalUpi ?? 0),
      avgProsesHari: row.avgProsesHari === null || row.avgProsesHari === undefined ? null : Number(row.avgProsesHari)
    };
  }

  static async getGradeDistribution(filters = {}) {
    const r = {};
    const where = buildWhere(filters, r);
    const rows = await dbHaccp.query(
      `SELECT COALESCE(NULLIF(TRIM(grade), ''), 'Tidak Ada') AS grade, COUNT(*) AS total
       FROM ${VIEW}
       ${where}
       GROUP BY grade
       ORDER BY total DESC`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ grade: x.grade, total: Number(x.total) }));
  }

  static async getStatusProduk(filters = {}) {
    const r = {};
    const where = buildWhere(filters, r);
    const rows = await dbHaccp.query(
      `SELECT COALESCE(NULLIF(TRIM(status_produk), ''), 'Tidak Ada') AS status_produk, COUNT(*) AS total
       FROM ${VIEW}
       ${where}
       GROUP BY status_produk
       ORDER BY total DESC`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ status_produk: x.status_produk, total: Number(x.total) }));
  }

  static async getKategoriProduk(filters = {}) {
    const r = {};
    const where = buildWhere(filters, r);
    const rows = await dbHaccp.query(
      `SELECT COALESCE(NULLIF(TRIM(nama_kategori), ''), 'Tidak Ada') AS nama_kategori, COUNT(*) AS total
       FROM ${VIEW}
       ${where}
       GROUP BY nama_kategori
       ORDER BY total DESC`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ nama_kategori: x.nama_kategori, total: Number(x.total) }));
  }

  static async getTopProduk(filters = {}, limit = 10) {
    const r = {};
    const where = buildWhere(filters, r);
    r.limit = limit;
    const rows = await dbHaccp.query(
      `SELECT COALESCE(NULLIF(TRIM(nama_produk), ''), 'Tidak Ada') AS nama_produk, COUNT(*) AS total
       FROM ${VIEW}
       ${where}
       GROUP BY nama_produk
       ORDER BY total DESC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ nama_produk: x.nama_produk, total: Number(x.total) }));
  }

  static async getTopUpt(filters = {}, limit = 10) {
    const r = {};
    const where = buildWhere(filters, r);
    r.limit = limit;
    const rows = await dbHaccp.query(
      `SELECT COALESCE(NULLIF(TRIM(upt), ''), 'Tidak Ada') AS upt, COUNT(*) AS total
       FROM ${VIEW}
       ${where}
       GROUP BY upt
       ORDER BY total DESC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ upt: x.upt, total: Number(x.total) }));
  }

  static async getMonthlyTrend(filters = {}) {
    const r = {};
    const where = buildWhere(filters, r);
    const rows = await dbHaccp.query(
      `SELECT DATE_FORMAT(tgl_terbit, '%Y-%m') AS bulan, COUNT(*) AS total
       FROM ${VIEW}
       ${where}
       GROUP BY bulan
       ORDER BY bulan ASC`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ bulan: x.bulan, total: Number(x.total) }));
  }

  static async getInvestmentDistribution(filters = {}) {
    const r = {};
    const where = buildWhere(filters, r);
    const rows = await dbHaccp.query(
      `SELECT COALESCE(NULLIF(TRIM(skala), ''), 'Tidak Ada') AS investment, COUNT(*) AS total
       FROM ${VIEW}
       ${where}
       GROUP BY 1
       ORDER BY total DESC`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map(x => ({ investment: x.investment, total: Number(x.total) }));
  }

  static async getTable(filters = {}, pagination = {}) {
    const r = {};
    const where = buildWhere(filters, r);

    let where2 = where;
    if (filters.search) {
      const searchCondition = '(upi_name LIKE :search OR nama_produk LIKE :search OR nama_kategori LIKE :search OR no_haccp LIKE :search OR upt LIKE :search)';
      where2 += `${where2 ? ' AND ' : 'WHERE '}${searchCondition}`;
      r.search = `%${String(filters.search).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }

    const page = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(pagination.limit) || 10));
    const offset = (page - 1) * limit;
    r.limit = limit;
    r.offset = offset;

    const rows = await dbHaccp.query(
      `SELECT no_haccp, upi_name, nama_produk, nama_kategori, grade, upt, tgl_terbit, tgl_akhir, status_sert
       FROM ${VIEW}
       ${where2}
       ORDER BY tgl_terbit DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    const countRows = await dbHaccp.query(
      `SELECT COUNT(*) AS total FROM ${VIEW} ${where2}`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return { rows, count: Number(countRows[0]?.total ?? 0), page, limit };
  }
}

export default HaccpRepository;
