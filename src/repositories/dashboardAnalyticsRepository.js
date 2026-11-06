import { cityScopeCondition } from '../utils/primerCityScope.js';
import { literal } from 'sequelize';
import {
  ReportEksport,
  TbSkpPaska,
  Vw07Sertifikasi,
  TrLaporanPrimerExport,
  CbibKapal,
} from '../models/index.js';
import { buildInClause, expandUptCodeFilter } from '../utils/uptCode.js';
import { AppError } from '../errors/appError.js';

/**
 * Konfigurasi sumber agregasi dashboard.
 *
 * `model` adalah referensi Model Sequelize dari `../models/index.js`
 * (Model-First Standard) — tidak ada lagi string nama tabel maupun instance
 * koneksi mentah di sini. Nama kolom (`date`, `unit`, `id`, `applicant`)
 * wajib sama dengan nama atribut pada Model terkait, karena ketiganya
 * disuntikkan ke dalam array `attributes` lewat `sequelize.literal()`.
 *
 * Nama tabel/kolom hanya berasal dari konfigurasi internal ini, tidak dari URL.
 */
const SOURCES = {
  ekspor: { model: ReportEksport, date: 'tanggal_smkhp', unit: 'kode_upt', id: 'nomor_aju', applicant: 'nama_trader', module: 'Ekspor', service: 'SMKHP', aliases: true },
  // tb_skp_paska TIDAK memiliki kolom UPT (tidak ada kd_unit, kode_upt, id_upt).
  // Kolom yang ada: id, nama_upi, nib, provinsi_id, provinsi, regency_id, kota_kabupaten, ...
  // Flag noUptColumn=true menandakan bahwa mode distribution/activities harus dihentikan
  // atau menggunakan nilai konstan, karena tidak bisa GROUP BY kolom UPT.
  skp: { model: TbSkpPaska, date: 'tanggal_terbit', unit: null, id: 'nomor_skp', applicant: 'nama_upi', module: 'Pasca Panen', service: 'SKP', noUptColumn: true },
  // HACCP view (vw07_sertifikasi) menggunakan kolom `upt` untuk tampilan/GROUP BY,
  // dan `kd_unit`/`id_upt` untuk filter WHERE (lihat haccpRepository.js).
  haccp: { model: Vw07Sertifikasi, date: 'tgl_terbit', unit: 'upt', whereUnit: '(kd_unit = :upt OR id_upt = :upt)', id: 'no_haccp', applicant: 'upi_name', module: 'Pasca Panen', service: 'HACCP' },
  primer: { model: TrLaporanPrimerExport, date: 'tgl_izin', unit: 'LEFT(kd_daerah, 4)', id: 'no_izin', applicant: 'nama_perseroan', module: 'Primer', service: 'Primer', primer: true },
  // tb_cbib_kapal: kolom UPT di DB adalah `kd_upt` (bukan kode_upt, bukan upt_inspeksi).
  // upt_inspeksi adalah nama UPT (string), kd_upt adalah kode UPT (15.0, 01.0, dll).
  // Pakai kd_upt untuk GROUP BY & filter WHERE. Alias ekspansi didukung via expandUptCodeFilter.
  kapal: { model: CbibKapal, date: 'tgl_terbit', unit: 'kd_upt', whereUnit: 'kd_upt = :upt', id: 'no_cbib', applicant: 'nama_pemilik', module: 'Primer', service: 'CPIB Kapal', kapal: true },
};

/**
 * Menyusun klausa `WHERE` (termasuk kata kunci `WHERE`) beserta objek
 * `replacements` untuk satu pembacaan.
 *
 * Bentuknya tetap string karena seluruh kondisi diteruskan ke
 * `sequelize.literal()` pada `Model.findAll`. Nilai pengguna hanya masuk
 * lewat `replacements` (`:startDate`, `:upt`, `:primerCity0`, ...); tidak
 * ada interpolasi nilai ke dalam SQL.
 *
 * PERHATIAN: fungsi ini TIDAK menyertakan kata kunci `WHERE`. Generator
 * Sequelize menambahkannya sendiri (`mainQueryItems.push(' WHERE ' + where)`
 * di `query-generator.js`), sehingga mengembalikan `'WHERE ...'` akan
 * menghasilkan `WHERE WHERE ...` dan gagal di MySQL.
 *
 * @param {Object} source Entri dari `SOURCES`.
 * @param {Object} filters Filter `{ startDate, endDate, uptId, cityScope }`.
 * @param {Object} replacements Objek yang diisi in-place oleh fungsi ini.
 * @returns {string} Kondisi yang disambung `AND`, atau string kosong bila
 *   tanpa kondisi.
 * @throws {AppError} 403 bila scope Primer/kapal tidak valid.
 */
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
  // Sengaja tanpa prefix 'WHERE ' — lihat catatan pada JSDoc fungsi ini.
  return conditions.join(' AND ');
}

/**
 * Repository agregasi dashboard (`kpi-summary`, tren bulanan, distribusi UPT,
 * dan recent activity) untuk lima sumber data.
 *
 * SELURUH pembacaan dieksekusi lewat `Model.findAll` dengan `attributes`
 * berupa `sequelize.literal()` (Model-First Standard) — tidak ada lagi
 * `db.query('SELECT ... FROM ' + table)` dengan string nama tabel.
 *
 * Mengapa `Model.findAll` untuk semua mode, termasuk `summary` yang hanya
 * menghasilkan `COUNT`:
 * - `summary` membutuhkan dua hitungan bersyarat (`total` + `berlaku`) dalam
 *   SATU pass tabel, yang tidak bisa dihasilkan `Model.count()`.
 * - `distribution`, `monthly`, dan `activities` selalu mengembalikan baris
 *   ber-alias (`unitKey`, `month`, `recordId`), sehingga bentuknya baris,
 *   bukan angka tunggal.
 *
 * `raw: true` WAJIB: tanpa itu Sequelize membangun instance Model dan alias
 * yang bukan atribut model (`total`, `unitKey`, `month`, ...) hilang dari
 * hasil. Dengan `raw: true`, nilai yang dikembalikan identik dengan raw
 * query sebelumnya (kolom DATE -> string 'YYYY-MM-DD', DATETIME -> Date).
 */
export default class DashboardAnalyticsRepository {
  /**
   * Menjalankan satu mode agregasi untuk satu sumber.
   *
   * @param {'ekspor'|'skp'|'haccp'|'primer'|'kapal'} sourceName Kunci `SOURCES`.
   * @param {'monthly'|'distribution'|'activities'|'summary'} mode Mode pembacaan.
   * @param {Object} filters Filter tanggal/UPT/scope kota.
   * @returns {Promise<Array<Object>>} Baris mentah yang sudah diberi
   *   `source`, `module`, `serviceName`, dan `total` ternormalisasi.
   * @throws {Error} Bila `sourceName`/`mode` tidak dikenal.
   */
  static async read(sourceName, mode, filters = {}) {
    const source = SOURCES[sourceName];
    if (!source || !['monthly','distribution','activities','summary'].includes(mode)) throw new Error('Konfigurasi agregasi dashboard tidak valid');
    const replacements = {};
    let where = whereFor(source, filters, replacements);
    if (mode === 'monthly' || mode === 'activities') where += (where ? ' AND ' : '') + source.date + ' IS NOT NULL';

    const attributes = [];
    const group = [];
    const order = [];
    let limit;

    if (mode === 'summary') {
      attributes.push([literal('COUNT(*)'), 'total']);
      if (sourceName === 'skp') attributes.push([literal('COUNT(CASE WHEN tanggal_kadaluarsa >= CURDATE() THEN 1 END)'), 'berlaku']);
      if (sourceName === 'haccp') attributes.push([literal("COUNT(CASE WHEN status_sert = 'BERLAKU' THEN 1 END)"), 'berlaku']);
    }
    if (mode === 'monthly') {
      attributes.push([literal('DATE_FORMAT(' + source.date + ", '%Y-%m')"), 'month']);
      attributes.push([literal('COUNT(*)'), 'total']);
      group.push(literal('month'));
      order.push([literal('month'), 'ASC']);
    }
    if (mode === 'distribution') {
      // Source tanpa kolom UPT (SKP) → kembalikan array kosong karena tidak bisa GROUP BY UPT
      if (source.noUptColumn) {
        return [];
      }
      attributes.push([literal(source.unit), 'unitKey']);
      attributes.push([literal('COUNT(*)'), 'total']);
      group.push(literal(source.unit));
      order.push([literal('total'), 'DESC']);
    }
    if (mode === 'activities') {
      attributes.push([literal(source.id), 'recordId']);
      attributes.push([literal(source.applicant), 'applicant']);
      // Source tanpa kolom UPT → gunakan nama service sebagai unitKey konstan.
      // `sourceName` sudah dijamin berupa kunci SOURCES oleh guard di atas,
      // sehingga aman disuntikkan sebagai literal string.
      attributes.push(source.noUptColumn ? [literal("'" + sourceName + "'"), 'unitKey'] : [literal(source.unit), 'unitKey']);
      attributes.push([literal(source.date), 'date']);
      order.push([literal(source.date), 'DESC'], [literal(source.id), 'DESC']);
      limit = 10;
    }

    const rows = await source.model.findAll({
      attributes,
      // Kondisi diteruskan sebagai literal (tanpa kata kunci `WHERE`,
      // karena generator Sequelize menambahkannya); seluruh nilai pengguna
      // sudah berada di `replacements`.
      ...(where ? { where: literal(where) } : {}),
      ...(group.length ? { group } : {}),
      ...(order.length ? { order } : {}),
      ...(limit ? { limit } : {}),
      replacements,
      raw: true,
    });

    return rows.map((row) => ({ ...row, source: sourceName, module: source.module, serviceName: source.service, ...(row.total === undefined ? {} : {total: Number(row.total)}) }));
  }
}
