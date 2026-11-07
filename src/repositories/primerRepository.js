import { cityScopeCondition } from '../utils/primerCityScope.js';
import DashboardAnalyticsRepository from './dashboardAnalyticsRepository.js';
import { AppError } from '../errors/appError.js';
import { literal } from 'sequelize';
import { TrLaporanPrimerExport, CbibKapal } from '../models/index.js';
import {
  buildInClause,
  expandUptCodeFilter,
  sanitizeLabel,
} from '../utils/uptCode.js';

/**
 * Repository untuk data laporan perizinan primer (`report_primer`).
 *
 * Tanggung jawab file ini HANYA membaca database. Tidak ada perhitungan bisnis,
 * tidak ada pagination logic, tidak ada pembentukan `WHERE` dari input mentah.
 * Semua nilai yang berasal dari user selalu masuk lewat `replacements` — tidak
 * ada interpolasi string ke SQL, termasuk untuk `IN (...)` (lihat #inClause).
 *
 * Model-First Standard: SELURUH pembacaan dieksekusi lewat Sequelize Model
 * `TrLaporanPrimerExport` (`tr_laporan_primer_export` / `dbPrimer`) dan
 * `CbibKapal` (`tb_cbib_kapal` / `dbKapal`) — tidak ada lagi `dbPrimer.query`
 * / `dbKapal.query` dengan string nama tabel. Agregasi memakai `findAll`
 * dengan atribut `[literal(...), alias]` + `raw: true`; nama tabel dan kolom
 * hanya berasal dari definisi Model.
 *
 * PERHATIAN Model-First: klausa kondisi TIDAK boleh menyertakan kata kunci
 * `WHERE` — generator Sequelize menambahkannya sendiri, sehingga `'WHERE ...'`
 * akan menghasilkan `WHERE WHERE ...`. Lihat `#whereOptions()`.
 *
 * Tabel sumber: `tr_laporan_primer_export` (994 baris, kolom tanggal hanya 2025
 * dan 2026). Tidak perlu prefix skema karena Model terikat ke `dbPrimer` yang
 * sudah terhubung langsung ke `report_primer`.
 *
 * Catatan penting soal tipe kolom — beberapa asumsi awal salah, berikut hasil
 * verifikasi langsung ke server:
 *
 * - `tgl_izin` bertipe `DATE`, bukan datetime. Jadi batas akhir filter cukup
 *   `23:59:59` pada tanggal tersebut; tidak ada komponen waktu yang terpotong.
 * - `total_hasil`, `total_minor`, `total_mayor`, dan `total_kritis` bertipe
 *   `VARCHAR`, bukan angka. `total_hasil` berisi label kategorikal
 *   ("Cukup", "Baik", "Sangat Baik", "P1"/"P2"/"P3", "LULUS", "-", dan NULL),
 *   sehingga breakdown harus `GROUP BY`, bukan `SUM`.
 *   Untuk rata-rata temuan, angka harus `CAST(... AS DECIMAL)` terlebih dahulu;
 *   tanpa itu MySQL diam-diam mem-stringify dan menghasilkan rata-rata keliru.
 *   String non-numerik seperti "-"/"" dan NULL diabaikan oleh `CAST`, dan
 *   `AVG` otomatis mengabaikan NULL, jadi peng_guard-an NULL sudah cukup.
 * - Kolom provinsi memang misspelling di database (`uraian_propinsi`) dan
 *   itulah nama yang dipakai di kueri.
 * - `kd_daerah` disimpan sebagai `VARCHAR` dan pollenya berawalan `0`
 *   (contoh: "3201"), bukan "32.01". Service harus mengirim apa adanya.
 *
 * Mengenai referensi `tb_perizinan` di skema `mutu`: tabel tersebut tidak dapat
 * diakses user aplikasi (`ER_DBACCESS_DENIED_ERROR`), dan tidak ada satupun tabel
 * bernama `tb_perizinan` di skema yang terlihat. Karena itu validasi jenis izin
 * di sini memakai whitelist `KODE_IZIN_PRIMER` di bawah — satu kueri, tanpa JOIN
 * lintas skema (yang juga dilarang oleh aturan dual-database). Skema yang ada
 * sudah memuat keempat kode tersebut, sehingga whitelist ini identik dengan
 * hasil validasi yang diminta.
 */

/**
 * Kode izin yang diizinkan pada modul primer.
 *
 * Hanya empat jenis ini yang ditampilkan. Data nyata juga memuat CPOIB
 * (032000000019, 30 baris) dan SPDI (032000000087, 7 baris), yang sengaja
 * dikeluarkan agar angka dashboard tidak tercampur jenis izin lain.
 *
 * Dipakai sebagai DEFAULT filter dan sekaligus whitelist: nilai `kdIzin` dari
 * luar hanya diterima bila ada di sini, sehingga tidak ada jalur untuk
 * menyuntikkan apa pun lewat parameter ini.
 */
export const KODE_IZIN_PRIMER = Object.freeze([
  '032000000014', // CPPIB
  '032000000034', // CPIB
  '032000000036', // CDOIB
  '032000000068', // CBIB
  '032000000033',  // CPIB Kapal
  '032000000019',  // CPOIB
  '032000000087'   // CDOIB
]);

/**
 * Rakit daftar kondisi (tanpa kata kunci `WHERE`) menjadi opsi `where` +
 * `replacements` siap pakai pada `Model.findAll` / `Model.count`.
 *
 * Kondisi dirangkai dengan `AND` lalu dibungkus `literal()` sehingga nilai
 * pengguna tetap berada di `replacements`, bukan di dalam string SQL.
 *
 * @param {string[]} conditions Daftar fragmen kondisi, mis. `tgl_izin >= :startDate`.
 * @param {object} replacements Objek replacements yang sudah diisi.
 * @returns {object} Opsi tambahan untuk dipadangkan ke options Model.
 */
function whereOptions(conditions, replacements) {
  return conditions.length
    ? { where: literal(conditions.join(' AND ')), replacements }
    : { replacements };
}

/**
 * Bangun klausa WHERE untuk filter UPT pada data kapal (tb_cbib_kapal.kd_upt).
 *
 * `kd_upt` pada data kapal bisa memiliki alias yang sama dengan `tr_report_ekspor`
 * (mis. `01.00`/`01.0` -> `15.0`), sehingga dipakai `expandUptCodeFilter` &
 * `buildInClause` untuk ekspansi alias yang seragam.
 *
 * @param {object} filter - Objek filter yang mungkin berisi `uptId`, `kd_upt`, `kode_upt`, dll.
 * @param {Record<string, unknown>} replacements - Objek replacements untuk query parameter.
 * @returns {string} Fragmen klausa SQL (mis. `kd_upt IN (...)`), atau string kosong.
 */
function buildKapalUptWhere(filter, replacements) {
  // Ambil kode UPT dari berbagai key yang mungkin dipakai frontend/controller
  const rawCode = sanitizeLabel(
    filter.uptId ??
    filter.kd_upt ??
    filter.kode_upt ??
    filter.kdUnit ??
    filter.kdUnit
  );

  if (!rawCode) {
    return '';
  }

  // Ekspansi alias: 15.0 -> ['15.0', '01.0', '01.00']
  const codes = expandUptCodeFilter(rawCode);
  if (codes.length === 0) {
    return '';
  }

  // Bangun klausa IN dengan placeholder terparameterisasi (tanpa 'AND' di depan)
  const inClause = buildInClause(codes, 'kapalUpt', replacements);
  return `kd_upt IN (${inClause})`;
}

class PrimerRepository {
  /**
   * Susun daftar kondisi filter beserta replacements-nya.
   *
   * Seluruh nilai dikirim via `replacements`. Parameter yang kosong
   * (undefined/null/'') sengaja diabaikan agar tidak muncul klausa `IS NULL`
   * yang tidak pernah diminta. Hasilnya array kondisi TANPA kata kunci `WHERE`
   * (generator Sequelize yang menambahkannya) — lewat `#whereOptions()` untuk
   * dipadangkan menjadi opsi `where`.
   *
   * @param {object} f - filter mentah dari service
   * @param {object} r - objek replacements yang akan diisi
   * @returns {string[]} fragmen-fragmen kondisi (boleh kosong)
   */
  static #conditions({ startDate, endDate, kdIzin, kdDaerah, search, cityScope }, r) {
    const w = [];

    // Rentang tanggal. `tgl_izin` berupa DATE sehingga batas akhir cukup
    // ditambah jam 23:59:59 agar hari tersebut ikut terhitung penuh.
    if (startDate) {
      w.push('tgl_izin BETWEEN :startDate AND :endDate');
      r.startDate = startDate;
      r.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
    } else if (endDate) {
      w.push('tgl_izin <= :endDate');
      r.endDate = `${endDate} 23:59:59`;
    }

    // Whitelist jenis izin. Nilai di luar daftar ditolak total, bukan
    // diabaikan: diam-diam kembali ke "semua jenis izin" justru membocorkan
    // data yang seharusnya tidak masuk modul ini.
    if (kdIzin) {
      if (!KODE_IZIN_PRIMER.includes(kdIzin)) {
        return ['1 = 0'];
      }
      w.push('kd_izin = :kdIzin');
      r.kdIzin = kdIzin;
    } else {
      w.push(`kd_izin IN (${this.#inClause(KODE_IZIN_PRIMER, 'izin', r)})`);
    }

    if (cityScope !== undefined) {
      w.push(cityScopeCondition(cityScope, r));
    }

    if (kdDaerah) {
      w.push('kd_daerah = :kdDaerah');
      r.kdDaerah = kdDaerah;
    }

    if (search) {
      w.push(
        '(nib LIKE :search OR nama_perseroan LIKE :search OR no_izin LIKE :search OR komoditas LIKE :search)'
      );
      // Wildcard LIKE harus di-escape. Tanpa ESCAPE, `%` dan `_` milik user
      // jadi wildcard yang disengaja dan bisa membuat kueri sangat lambat.
      r.search = `%${String(search).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }

    return w;
  }

  /**
   * Bangun placeholder `IN (:nama, :nama2, ...)` dan daftarkan key-nya ke
   * replacements.
   *
   * Daftar IN harus tetap diparameterkan; menggabungkan string ke SQL berarti
   * membuka celah injeksi.
   *
   * @param {Array<string|number>} values - nilai yang akan di-bind
   * @param {string} prefix - awalan nama parameter, mis. 'izin'
   * @param {object} r - objek replacements yang akan diisi
   * @returns {string} fragmen `:izin0, :izin1, ...` siap disisipkan di `IN (...)`
   */
  static #inClause(values, prefix, r) {
    return values
      .map((v, i) => {
        const key = `${prefix}${i}`;
        r[key] = v;
        return `:${key}`;
      })
      .join(', ');
  }

  /**
   * Ringkasan metrik untuk KPI.
   *
   * Mengembalikan satu baris berisi total sertifikat, jumlah entitas/NIB unik,
   * breakdown per `total_hasil`, rata-rata temuan, dan waktu sinkronisasi
   * terakhir. Breakdown diambil lewat kueri terpisah karena `GROUP BY` pada
   * kueri utama akan memenggal kolom agregat.
   *
   * @param {object} filter
   * @returns {Promise<object>} satu baris metrik + array `breakdownHasil`
   */
  static async getSummaryMetrics(filter = {}) {
    const r = {};
    const base = whereOptions(this.#conditions(filter, r), r);

    const summary = await TrLaporanPrimerExport.findAll({
      attributes: [
        [literal('COUNT(*)'), 'totalSertifikat'],
        [literal('COUNT(DISTINCT nib)'), 'totalEntitas'],
        [literal('AVG(CAST(total_minor AS DECIMAL(12,2)))'), 'rataMinor'],
        [literal('AVG(CAST(total_mayor AS DECIMAL(12,2)))'), 'rataMayor'],
        [literal('AVG(CAST(total_kritis AS DECIMAL(12,2)))'), 'rataKritis'],
        [literal('MAX(tgl_tarik_data)'), 'tglSyncTerakhir'],
      ],
      ...base,
      raw: true,
    });

    const breakdownExpr = "COALESCE(NULLIF(TRIM(total_hasil), ''), '(Kosong)')";
    const breakdown = await TrLaporanPrimerExport.findAll({
      attributes: [
        [literal(breakdownExpr), 'statusHasil'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal(breakdownExpr)],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });

    const row = summary[0] ?? {};

    // Rata-rata yang tidak ada barisnya dinormalkan ke null, bukan 0, supaya
    // UI bisa membedakan "tidak ada data" dari "rata-ratanya benar-benar nol".
    const avg = (v) => (v === null || v === undefined ? null : Number(v));

    return {
      totalSertifikat: Number(row.totalSertifikat ?? 0),
      totalEntitas: Number(row.totalEntitas ?? 0),
      rataMinor: avg(row.rataMinor),
      rataMayor: avg(row.rataMayor),
      rataKritis: avg(row.rataKritis),
      tglSyncTerakhir: row.tglSyncTerakhir ?? null,
      breakdownHasil: breakdown.map((b) => ({
        statusHasil: b.statusHasil,
        total: Number(b.total)
      }))
    };
  }

  /**
   * Jumlah sertifikat per bulan untuk satu tahun.
   *
   * Mengembalikan tepat 12 elemen (Januari–Desember) sehingga chart yearly
   * tidak bolong di bulan yang belum ada datanya.
   *
   * @param {object} filter - `{ year, kdIzin, kdDaerah }`
   * @returns {Promise<Array<{ bulan: number, total: number }>>}
   */
  static async getMonthlyTrends(filter = {}) {
    const r = {};
    const effectiveFilter = {
      ...filter,
      startDate: filter.startDate || `${filter.year || new Date().getFullYear()}-01-01`,
      endDate: filter.endDate || `${filter.year || new Date().getFullYear()}-12-31`,
    };
    const base = whereOptions(this.#conditions(effectiveFilter, r), r);

    const rows = await TrLaporanPrimerExport.findAll({
      attributes: [
        [literal('MONTH(tgl_izin)'), 'bulan'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal('MONTH(tgl_izin)')],
      order: [[literal('bulan'), 'ASC']],
      raw: true,
    });

    const perBulan = new Map(rows.map((x) => [Number(x.bulan), Number(x.total)]));

    // Jika filter startDate & endDate ada, sesuaikan rentang bulan yang ditampilkan
    const startMonth = filter.startDate ? new Date(filter.startDate).getMonth() + 1 : 1;
    const endMonth = filter.endDate ? new Date(filter.endDate).getMonth() + 1 : 12;

    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const result = [];

    for (let m = startMonth; m <= endMonth; m++) {
      result.push({
        bulan: m,
        labelBulan: labels[m - 1],
        total: perBulan.get(m) ?? 0,
      });
    }

    return result;
  }

  /**
   * Distribusi sertifikat per provinsi, diurutkan dari volume terbesar.
   *
   * @param {object} filter - `{ startDate, endDate, kdIzin, limit }`
   * @returns {Promise<Array<{ provinsi: string, total: number }>>}
   */
  static async getDistributionByProvince(filter = {}) {
    const r = {};
    const base = whereOptions(this.#conditions(filter, r), r);
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;

    const rows = await TrLaporanPrimerExport.findAll({
      attributes: [
        [literal('uraian_propinsi'), 'provinsi'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal('uraian_propinsi')],
      order: [[literal('total'), 'DESC'], [literal('provinsi'), 'ASC']],
      limit,
      raw: true,
    });

    return rows.map((x) => ({ provinsi: x.provinsi, total: Number(x.total) }));
  }

  /**
   * Distribusi sertifikat per komoditas.
   *
   * Komoditas kosong, '-', dan NULL tidak dimasukkan karena bukan komoditas
   * sungguhan dan hanya menambah kategori kosong pada grafik.
   *
   * @param {object} filter - `{ startDate, endDate, kdIzin, limit }`
   * @returns {Promise<Array<{ komoditas: string, total: number }>>}
   */
  static async getDistributionByKomoditas(filter = {}) {
    const r = {};
    const conditions = this.#conditions(filter, r);
    conditions.push("komoditas IS NOT NULL");
    conditions.push("TRIM(komoditas) NOT IN ('', '-')");
    const base = whereOptions(conditions, r);
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;

    const rows = await TrLaporanPrimerExport.findAll({
      attributes: [
        [literal('komoditas'), 'komoditas'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal('komoditas')],
      order: [[literal('total'), 'DESC'], [literal('komoditas'), 'ASC']],
      limit,
      raw: true,
    });

    return rows.map((x) => ({ komoditas: x.komoditas, total: Number(x.total) }));
  }

  /**
   * Halaman data untuk tabel detail, sekaligus jumlah total baris.
   *
   * `COUNT` memakai filter yang sama persis dengan `SELECT` supaya nomor
   * paginasi tidak pernah meleset dari isi tabel.
   *
   * @param {object} filter
   * @returns {Promise<{ rows: object[], count: number }>}
   */
  static async findAllPaginated(filter = {}) {
    const r = {};
    const base = whereOptions(this.#conditions(filter, r), r);

    const page = Number.isInteger(filter.page) && filter.page > 0 ? filter.page : 1;
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    const offset = (page - 1) * limit;

    // Kolom `sortBy` tidak bisa di-bind sebagai parameter, jadi dipetakan lewat
    // whitelist. Nilai di luar daftar jatuh ke default, bukan ikut masuk SQL.
    const allowedSort = ['tgl_izin', 'nama_perseroan', 'nib', 'no_izin', 'kd_daerah'];
    const sortCol = allowedSort.includes(filter.sortBy) ? filter.sortBy : 'tgl_izin';
    const order = String(filter.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const rows = await TrLaporanPrimerExport.findAll({
      attributes: [
        'id_export', 'idchecklist', 'tgl_izin', 'id_izin', 'jenis_izin', 'kd_izin',
        'ur_izin_singkat', 'kd_daerah', 'nama_izin', 'no_izin', 'nib',
        'tgl_permohonan', 'status_checklist', 'sts_aktif', 'komoditas', 'kbli',
        'uraian_propinsi', 'nama_perseroan', 'alamat_perseroan', 'kelurahan_perseroan',
        'perseroan_daerah_id', 'kode_pos_perseroan', 'nomor_telpon_perseroan',
        'email_perusahaan', 'total_sesuai', 'total_minor', 'total_mayor', 'total_kritis',
        'total_hasil', 'keterangan', 'tgl_tarik_data', 'sumber_data',
      ],
      ...base,
      order: [[sortCol, order], ['id_export', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const countRows = await TrLaporanPrimerExport.findAll({
      attributes: [[literal('COUNT(*)'), 'total']],
      ...base,
      raw: true,
    });

    return { rows, count: Number(countRows[0]?.total ?? 0) };
  }

  /**
   * Ringkasan metrik untuk CPIB Kapal (kd_izin = '032000000033').
   *
   * Sumber data: report_kapal.tb_cbib_kapal
   * Filter tanggal berdasarkan kolom tgl_terbit (BETWEEN startDate AND endDate).
   *
   * @param {object} filter - { startDate, endDate }
   * @returns {Promise<object>}
   */
  static async getKapalSummaryMetrics(filter = {}) {
    const r = {};
    const base = whereOptions(this.#kapalConditions(filter, r), r);

    const rows = await CbibKapal.findAll({
      attributes: [
        [literal('COUNT(id_cbib)'), 'totalSertifikat'],
        [literal('SUM(COALESCE(gt, 0))'), 'totalGT'],
        [literal('SUM(COALESCE(jumlah_abk, 0))'), 'totalABK'],
        [literal('COUNT(CASE WHEN tgl_kadaluarsa >= CURDATE() THEN 1 END)'), 'totalAktif'],
        [literal('NULL'), 'tglSyncTerakhir'],
      ],
      ...base,
      raw: true,
    });

    const row = rows[0] ?? {};
    return {
      totalSertifikat: Number(row.totalSertifikat ?? 0),
      totalGT: Number(row.totalGT ?? 0),
      totalABK: Number(row.totalABK ?? 0),
      totalAktif: Number(row.totalAktif ?? 0),
      tglSyncTerakhir: row.tglSyncTerakhir ?? null
    };
  }

  /**
   * Susun kondisi filter kapal (tanggal terbit + UPT) beserta replacements-nya.
   *
   * Dipakai bersama oleh seluruh pembacaan `CbibKapal` di repository ini.
   * Sama seperti `#conditions`, hasilnya array kondisi tanpa kata kunci `WHERE`.
   *
   * @param {object} filter
   * @param {object} r - objek replacements yang akan diisi
   * @returns {string[]} fragmen-fragmen kondisi
   */
  static #kapalConditions(filter, r) {
    const w = [];
    if (filter.startDate) {
      w.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      w.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    // Filter UPT: gunakan kode_upt yang sudah dipetakan ke KD_UNIT master
    const uptWhere = buildKapalUptWhere(filter, r);
    if (uptWhere) w.push(uptWhere);
    return w;
  }

  static async getKapalMonthlyTrends(filter = {}) {
    const r = {};
    const base = whereOptions(this.#kapalConditions(filter, r), r);

    const rows = await CbibKapal.findAll({
      attributes: [
        [literal("DATE_FORMAT(tgl_terbit, '%Y-%m')"), 'periode'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal('periode')],
      order: [[literal('periode'), 'ASC']],
      raw: true,
    });
    return rows.map((x) => ({ periode: x.periode, total: Number(x.total) }));
  }

  static async getKapalDistributionByGrade(filter = {}) {
    const r = {};
    const base = whereOptions(this.#kapalConditions(filter, r), r);
    const gradeExpr = "COALESCE(NULLIF(TRIM(grade_scpib), ''), 'Non Grade')";

    const rows = await CbibKapal.findAll({
      attributes: [
        [literal(gradeExpr), 'grade'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal(gradeExpr)],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });
    return rows.map((x) => ({ grade: x.grade, total: Number(x.total) }));
  }

  static async getKapalGTSegments(filter = {}) {
    const r = {};
    const base = whereOptions(this.#kapalConditions(filter, r), r);

    const rows = await CbibKapal.findAll({
      attributes: [
        [literal('SUM(CASE WHEN COALESCE(gt,0) < 10 THEN 1 ELSE 0 END)'), 'lt10'],
        [literal('SUM(CASE WHEN COALESCE(gt,0) >= 10 AND COALESCE(gt,0) <= 30 THEN 1 ELSE 0 END)'), 'g10_30'],
        [literal('SUM(CASE WHEN COALESCE(gt,0) >= 31 AND COALESCE(gt,0) <= 100 THEN 1 ELSE 0 END)'), 'g31_100'],
        [literal('SUM(CASE WHEN COALESCE(gt,0) > 100 THEN 1 ELSE 0 END)'), 'gt100'],
      ],
      ...base,
      raw: true,
    });
    const row = rows[0] ?? {};
    return {
      '<10': Number(row.lt10 ?? 0),
      '10-30': Number(row.g10_30 ?? 0),
      '31-100': Number(row.g31_100 ?? 0),
      '>100': Number(row.gt100 ?? 0)
    };
  }

  static async getKapalTopAlatTangkap(filter = {}, limit = 7) {
    const r = {};
    const conditions = this.#kapalConditions(filter, r);
    conditions.push('alat_tangkap IS NOT NULL');
    conditions.push("TRIM(alat_tangkap) <> ''");
    const base = whereOptions(conditions, r);

    const rows = await CbibKapal.findAll({
      attributes: [
        [literal('TRIM(alat_tangkap)'), 'alat_tangkap'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal('TRIM(alat_tangkap)')],
      order: [[literal('total'), 'DESC']],
      limit,
      raw: true,
    });
    return rows.map((x) => ({ alat_tangkap: x.alat_tangkap, total: Number(x.total) }));
  }

  static async getKapalTopPelabuhan(filter = {}, limit = 10) {
    const r = {};
    const conditions = this.#kapalConditions(filter, r);
    conditions.push('nama_pelabuhan IS NOT NULL');
    conditions.push("TRIM(nama_pelabuhan) <> ''");
    const base = whereOptions(conditions, r);

    const rows = await CbibKapal.findAll({
      attributes: [
        [literal('TRIM(nama_pelabuhan)'), 'nama_pelabuhan'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal('TRIM(nama_pelabuhan)')],
      order: [[literal('total'), 'DESC']],
      limit,
      raw: true,
    });
    return rows.map((x) => ({ nama_pelabuhan: x.nama_pelabuhan, total: Number(x.total) }));
  }

  static async getKapalSebaranWPP(filter = {}, limit = 10) {
    const r = {};
    const conditions = this.#kapalConditions(filter, r);
    conditions.push('daerah_tangkap IS NOT NULL');
    conditions.push("TRIM(daerah_tangkap) <> ''");
    const base = whereOptions(conditions, r);

    const rows = await CbibKapal.findAll({
      attributes: [
        [literal('TRIM(daerah_tangkap)'), 'daerah_tangkap'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...base,
      group: [literal('TRIM(daerah_tangkap)')],
      order: [[literal('total'), 'DESC']],
      limit,
      raw: true,
    });
    return rows.map((x) => ({ daerah_tangkap: x.daerah_tangkap, total: Number(x.total) }));
  }

  static async findKapalPaginated(filter = {}) {
    const r = {};
    const conditions = this.#kapalConditions(filter, r);
    if (filter.search) {
      conditions.push('(no_cbib LIKE :search OR nama_kapal LIKE :search OR nama_pemilik LIKE :search OR alat_tangkap LIKE :search OR nama_pelabuhan LIKE :search)');
      r.search = `%${String(filter.search).replace(/[\%_]/g, (c) => `\${c}`)}%`;
    }
    const base = whereOptions(conditions, r);

    const page = Number.isInteger(filter.page) && filter.page > 0 ? filter.page : 1;
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    const offset = (page - 1) * limit;

    const allowedSort = ['tgl_terbit', 'tgl_kadaluarsa', 'nama_kapal', 'gt', 'grade_scpib'];
    const sortCol = allowedSort.includes(filter.sortBy) ? filter.sortBy : 'tgl_terbit';
    const order = String(filter.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const rows = await CbibKapal.findAll({
      attributes: [
        'id_cbib', 'no_cbib', 'nama_kapal', 'gt', 'tipe_kapal', 'tgl_permohonan', 'tgl_spt',
        'tgl_awal_inspeksi', 'tgl_akhir_inspeksi', 'tgl_laporan', 'jenis_produk', 'grade_scpib',
        'tgl_terbit', 'tgl_kadaluarsa', 'upt_inspeksi', 'kd_upt', 'nama_pelabuhan', 'kode_provinsi',
        'nama_provinsi', 'status_pemasok', 'nama_pemilik', 'jumlah_abk', 'alat_tangkap',
        'daerah_tangkap', 'no_siup', 'no_kbli', 'pj_pusat',
      ],
      ...base,
      order: [[sortCol, order], ['id_cbib', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const countRows = await CbibKapal.findAll({
      attributes: [[literal('COUNT(*)'), 'total']],
      ...base,
      raw: true,
    });

    return { rows, count: Number(countRows[0]?.total ?? 0) };
  }

  /**
   * KPI agregat Primer untuk halaman dashboard overview (multi-jenis izin).
   *
   * Satu kueri `COUNT(*)` untuk total + lima kueri `COUNT(*)` per kode izin
   * dijalankan paralel lewat `TrLaporanPrimerExport.findAll` dengan atribut
   * literal. Angka kapal (CPIB Kapal) datang dari `CbibKapal`, BUKAN JOIN
   * lintas koneksi — dua Model, dua instance, digabung di memori.
   */
  static async getAggregatedSummary({ startDate, endDate, uptId, cityScope, isNationalAccess } = {}) {
    if (uptId && !cityScope) throw new AppError('Scope kota wajib untuk filter UPT Primer', 403);
    const r = {};
    const w = [];
    if (startDate) {
      w.push('tgl_izin >= :startDate');
      r.startDate = startDate;
    }
    if (endDate) {
      w.push('tgl_izin <= :endDate');
      r.endDate = `${endDate} 23:59:59`;
    }
    if (cityScope !== undefined) {
      w.push(cityScopeCondition(cityScope, r));
    }
    const base = whereOptions(w, r);
    const totalRows = await TrLaporanPrimerExport.findAll({
      attributes: [[literal('COUNT(*)'), 'total']],
      ...base,
      raw: true,
    });
    const row = totalRows[0] ?? {};

    // Breakdown per jenis. `where` dasar diulang + kondisi kd_izin terparameterisasi.
    const perIzin = async (key, kode) => {
      const conditions = [...w, `kd_izin = :${key}`];
      const rows = await TrLaporanPrimerExport.findAll({
        attributes: [[literal('COUNT(*)'), 'c']],
        ...whereOptions(conditions, { ...r, [key]: kode }),
        raw: true,
      });
      return Number(rows[0]?.c ?? 0);
    };
    const [cpib, cbib, cppib, cpoib, cdoib] = await Promise.all([
      perIzin('izinCpib', '032000000034'),
      perIzin('izinCbib', '032000000068'),
      perIzin('izinCppib', '032000000014'),
      perIzin('izinCpoib', '032000000019'),
      perIzin('izinCdoib', '032000000087'),
    ]);

    // kapal
    // Kapal disertakan untuk:
    // - Tampilan nasional tanpa filter UPT (uptId kosong, cityScope kosong)
    // - Tampilan nasional dengan filter UPT (isNationalAccess=true, uptId ada, cityScope dari UPT tsb)
    // Kapal TIDAK disertakan untuk user non-nasional (isNationalAccess=false, uptId=UPT akun, cityScope dari UPT akun)
    const includeKapal = (!cityScope && !uptId) || (isNationalAccess && uptId);

    let cpibKapalCount = 0;
    if (includeKapal) {
      const rw = {};
      const ww = [];
      if (startDate) { ww.push('tgl_terbit >= :startDate'); rw.startDate = startDate; }
      if (endDate) { ww.push('tgl_terbit <= :endDate'); rw.endDate = `${endDate} 23:59:59`; }
      // Apply UPT filter for kapal if uptId provided
      if (uptId) {
        const uptWhere = buildKapalUptWhere({ uptId }, rw);
        if (uptWhere) ww.push(uptWhere.trim());
      }
      const rk = await CbibKapal.findAll({
        attributes: [[literal('COUNT(*)'), 'c']],
        ...whereOptions(ww, rw),
        raw: true,
      });
      cpibKapalCount = Number(rk[0]?.c ?? 0);
    }

    // Total sertifikat primer = baris `tr_laporan_primer_export` + sertifikat
    // CPIB Kapal dari `tb_cbib_kapal`. Keduanya berasal dari tabel berbeda
    // (bahkan skema berbeda) sehingga tidak mungkin saling tumpang tindih:
    // `tr_laporan_primer_export` sama sekali tidak memuat kd_izin
    // '032000000033'. Karena `detail.cpibKapal` ikut ditampilkan di overview,
    // totalnya wajib sudah memasukkan angka itu — kalau tidak, detail akan
    // menjumlah lebih besar dari totalnya sendiri.
    const totalSertifikat = Number(row.total ?? 0) + cpibKapalCount;

    return {
      totalSertifikat,
      totalSertifikatTerbit: totalSertifikat,
      totalPending: 0,
      detail: {
        cpib,
        cbib,
        cppib,
        cpoib,
        cdoib,
        cpibKapal: cpibKapalCount
      },
      kpi: {
        totalSertifikat,
        totalPending: 0,
        detail: {
          cpib,
          cbib,
          cppib,
          cpoib,
          cdoib,
          cpibKapal: cpibKapalCount
        }
      }
    };
  }

  static async readDashboard(mode, filters = {}) {
    const sources = filters.cityScope || filters.uptId ? ['primer'] : ['primer', 'kapal'];
    return (await Promise.all(sources.map(source => DashboardAnalyticsRepository.read(source, mode, filters)))).flat();
  }
  static getDashboardMonthlyTrends(filters = {}) { return this.readDashboard('monthly', filters); }
  static getByUpt(filters = {}) { return this.readDashboard('distribution', filters); }
  static getRecentActivities(filters = {}) { return this.readDashboard('activities', filters); }
}
export default PrimerRepository;
