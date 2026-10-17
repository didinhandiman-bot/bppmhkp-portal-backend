import { cityScopeCondition } from '../utils/primerCityScope.js';
import { QueryTypes } from 'sequelize';
import { dbReport, dbReportSkp, dbHaccp, dbPrimer, dbKapal } from '../config/database.js';
import { buildInClause, expandUptCodeFilter } from '../utils/uptCode.js';
import { AppError } from '../errors/appError.js';

// Nama tabel/kolom hanya berasal dari konfigurasi internal ini, tidak dari URL.
const SOURCES = {
  ekspor: { db: dbReport, table: 'tr_report_ekspor', date: 'tanggal_smkhp', unit: 'kode_upt', id: 'nomor_aju', applicant: 'nama_trader', module: 'Ekspor', service: 'SMKHP', aliases: true },
  // tb_skp_paska TIDAK memiliki kolom UPT (tidak ada kd_unit, kode_upt, id_upt).
  // Kolom yang ada: id, nama_upi, nib, provinsi_id, provinsi, regency_id, kota_kabupaten, ...
  // Flag noUptColumn=true menandakan bahwa mode distribution/activities harus dihentikan
  // atau menggunakan nilai konstan, karena tidak bisa GROUP BY kolom UPT.
  skp: { db: dbReportSkp, table: 'tb_skp_paska', date: 'tanggal_terbit', unit: null, id: 'nomor_skp', applicant: 'nama_upi', module: 'Pasca Panen', service: 'SKP', noUptColumn: true },
  // HACCP view (vw07_sertifikasi) menggunakan kolom `upt` untuk tampilan/GROUP BY,
  // dan `kd_unit`/`id_upt` untuk filter WHERE (lihat haccpRepository.js).
  haccp: { db: dbHaccp, table: 'vw07_sertifikasi', date: 'tgl_terbit', unit: 'upt', whereUnit: '(kd_unit = :upt OR id_upt = :upt)', id: 'no_haccp', applicant: 'upi_name', module: 'Pasca Panen', service: 'HACCP' },
  primer: { db: dbPrimer, table: 'tr_laporan_primer_export', date: 'tgl_izin', unit: 'LEFT(kd_daerah, 4)', id: 'no_izin', applicant: 'nama_perseroan', module: 'Primer', service: 'Primer', primer: true },
  // tb_cbib_kapal: kolom UPT di DB adalah `kd_upt` (bukan kode_upt, bukan upt_inspeksi).
  // upt_inspeksi adalah nama UPT (string), kd_upt adalah kode UPT (15.0, 01.0, dll).
  // Pakai kd_upt untuk GROUP BY & filter WHERE. Alias ekspansi didukung via expandUptCodeFilter.
  kapal: { db: dbKapal, table: 'tb_cbib_kapal', date: 'tgl_terbit', unit: 'kd_upt', whereUnit: 'kd_upt = :upt', id: 'no_cbib', applicant: 'nama_pemilik', module: 'Primer', service: 'CPIB Kapal', kapal: true },
};

function whereFor(source, filters, replacements) {
  const conditions = [];
  if (filters.startDate) {
    conditions.push(source.date + ' >= :startDate');
    replacements.startDate = filters.startDate;
  }
  if (filters.endDate) {
    conditions.push(source.date + ' <= :endDate');
    replacements.endDate = filters.endDate + ' 23:59:59';
  }
  if (source.primer) {
    if (filters.uptId && !filters.cityScope) throw new AppError('Scope kota wajib untuk filter UPT Primer', 403);
    if (filters.cityScope !== undefined) {
      conditions.push(cityScopeCondition(filters.cityScope, replacements));
    }
  } else if (source.kapal) {
    // Kapal sekarang mendukung filter UPT via kd_upt (dengan alias ekspansi).
    // cityScope tetap tidak didukung untuk kapal.
    if (filters.cityScope) throw new AppError('Pemetaan kota untuk kapal belum tersedia', 403);
  } else if (source.noUptColumn) {
    // SKP tidak punya kolom UPT — tidak bisa difilter by uptId.
    // Jika caller mengirim uptId, abaikan (atau bisa throw error bila ingin strict).
    // Di sini kita abaikan agar tidak crash; filter UPT hanya berlaku untuk source lain.
  } else if (filters.uptId) {
    if (source.aliases) {
      const clause = buildInClause(expandUptCodeFilter(filters.uptId), 'upt', replacements);
      conditions.push(source.unit + ' IN (' + clause + ')');
    } else if (source.whereUnit) {
      // Custom WHERE clause for sources like HACCP/Kapal that filter on different columns than display
      conditions.push(source.whereUnit);
      replacements.upt = filters.uptId;
    } else {
      conditions.push(source.unit + ' = :upt');
      replacements.upt = filters.uptId;
    }
  }
  return conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
}

export default class DashboardAnalyticsRepository {
  static async read(sourceName, mode, filters = {}) {
    const source = SOURCES[sourceName];
    if (!source || !['monthly','distribution','activities','summary'].includes(mode)) throw new Error('Konfigurasi agregasi dashboard tidak valid');
    const replacements = {};
    let where = whereFor(source, filters, replacements);
    if (mode === 'monthly' || mode === 'activities') where += (where ? ' AND ' : 'WHERE ') + source.date + ' IS NOT NULL';
    let select, suffix;
    if (mode === 'summary') {
      select = 'COUNT(*) AS total';
      if (sourceName === 'skp') select += ', COUNT(CASE WHEN tanggal_kadaluarsa >= CURDATE() THEN 1 END) AS berlaku';
      if (sourceName === 'haccp') select += ", COUNT(CASE WHEN status_sert = 'BERLAKU' THEN 1 END) AS berlaku";
      suffix = '';
    }
    if (mode === 'monthly') {
      select = "DATE_FORMAT(" + source.date + ", '%Y-%m') AS month, COUNT(*) AS total";
      suffix = 'GROUP BY month ORDER BY month';
    }
    if (mode === 'distribution') {
      // Source tanpa kolom UPT (SKP) → kembalikan array kosong karena tidak bisa GROUP BY UPT
      if (source.noUptColumn) {
        return [];
      }
      select = source.unit + ' AS unitKey, COUNT(*) AS total';
      suffix = 'GROUP BY ' + source.unit + ' ORDER BY total DESC';
    }
    if (mode === 'activities') {
      // Source tanpa kolom UPT → gunakan nama service sebagai unitKey konstan
      if (source.noUptColumn) {
        select = source.id + ' AS recordId, ' + source.applicant + ' AS applicant, \'' + sourceName + '\' AS unitKey, ' + source.date + ' AS date';
      } else {
        select = source.id + ' AS recordId, ' + source.applicant + ' AS applicant, ' + source.unit + ' AS unitKey, ' + source.date + ' AS date';
      }
      suffix = 'ORDER BY ' + source.date + ' DESC, ' + source.id + ' DESC LIMIT 10';
    }
    const rows = await source.db.query('SELECT ' + select + ' FROM ' + source.table + ' ' + where + ' ' + suffix, { replacements, type: QueryTypes.SELECT });
    return rows.map((row) => ({ ...row, source: sourceName, module: source.module, serviceName: source.service, ...(row.total === undefined ? {} : {total: Number(row.total)}) }));
  }
}
