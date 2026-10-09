import { QueryTypes } from 'sequelize';
import { dbPrimer, dbKapal } from '../config/database.js';
import models from '../models/index.js';

/**
 * Repository untuk data laporan perizinan primer (`report_primer`).
 *
 * Tanggung jawab file ini HANYA membaca database. Tidak ada perhitungan bisnis,
 * tidak ada pagination logic, tidak ada pembentukan `WHERE` dari input mentah.
 * Semua nilai yang berasal dari user selalu masuk lewat `replacements` — tidak
 * ada interpolasi string ke SQL, termasuk untuk `IN (...)` (lihat #inClause).
 *
 * Tabel sumber: `tr_laporan_primer_export` (994 baris, kolom tanggal hanya 2025
 * dan 2026). Tidak perlu prefix skema karena `dbPrimer` sudah terhubung langsung
 * ke `report_primer`.
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

/** Nama tabel, dipakai berulang oleh seluruh kueri di file ini. */
const TABEL = 'tr_laporan_primer_export';

class PrimerRepository {
  /**
   * Susun daftar `WHERE` beserta replacements-nya.
   *
   * Seluruh nilai dikirim via `replacements`; `LIMIT`/`OFFSET` pun ikut
   * di-bind. Parameter yang kosong (undefined/null/'') sengaja diabaikan agar
   * tidak muncul klausa `IS NULL` yang tidak pernah diminta.
   *
   * @param {object} f - filter mentah dari service
   * @param {object} r - objek replacements yang akan diisi
   * @returns {string} fragmen SQL untuk 'WHERE' (boleh kosong)
   */
  static #buildWhere({ startDate, endDate, kdIzin, kdDaerah, search }, r) {
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
        return 'WHERE 1 = 0';
      }
      w.push('kd_izin = :kdIzin');
      r.kdIzin = kdIzin;
    } else {
      w.push(`kd_izin IN (${this.#inClause(KODE_IZIN_PRIMER, 'izin', r)})`);
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

    return w.length ? `WHERE ${w.join(' AND ')}` : '';
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
   * terakhir. Breakdown diambil lewat subquery terpisah karena `GROUP BY` pada
   * kueri utama akan memenggal kolom agregat.
   *
   * @param {object} filter
   * @returns {Promise<object>} satu baris metrik + array `breakdownHasil`
   */
  static async getSummaryMetrics(filter = {}) {
    const r = {};
    const where = this.#buildWhere(filter, r);

    const summary = await dbPrimer.query(
      `SELECT
         COUNT(*)                                            AS totalSertifikat,
         COUNT(DISTINCT nib)                                  AS totalEntitas,
         AVG(CAST(total_minor AS DECIMAL(12,2)))              AS rataMinor,
         AVG(CAST(total_mayor AS DECIMAL(12,2)))              AS rataMayor,
         AVG(CAST(total_kritis AS DECIMAL(12,2)))             AS rataKritis,
         MAX(tgl_tarik_data)                                  AS tglSyncTerakhir
       FROM ${TABEL}
       ${where}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const breakdown = await dbPrimer.query(
      `SELECT
         COALESCE(NULLIF(TRIM(total_hasil), ''), '(Kosong)') AS statusHasil,
         COUNT(*)                                             AS total
       FROM ${TABEL}
       ${where}
       GROUP BY COALESCE(NULLIF(TRIM(total_hasil), ''), '(Kosong)')
       ORDER BY total DESC`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = this.#buildWhere(effectiveFilter, r);

    const rows = await dbPrimer.query(
      `SELECT MONTH(tgl_izin) AS bulan, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
       GROUP BY MONTH(tgl_izin)
       ORDER BY bulan`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = this.#buildWhere(filter, r);
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    r.limit = limit;

    const rows = await dbPrimer.query(
      `SELECT uraian_propinsi AS provinsi, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
       GROUP BY uraian_propinsi
       ORDER BY total DESC, provinsi ASC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = this.#buildWhere(filter, r);
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    r.limit = limit;

    const rows = await dbPrimer.query(
      `SELECT komoditas, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
         AND komoditas IS NOT NULL
         AND TRIM(komoditas) NOT IN ('', '-')
       GROUP BY komoditas
       ORDER BY total DESC, komoditas ASC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = this.#buildWhere(filter, r);

    const page = Number.isInteger(filter.page) && filter.page > 0 ? filter.page : 1;
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    const offset = (page - 1) * limit;
    r.limit = limit;
    r.offset = offset;

    // Kolom `sortBy` tidak bisa di-bind sebagai parameter, jadi dipetakan lewat
    // whitelist. Nilai di luar daftar jatuh ke default, bukan ikut masuk SQL.
    const allowedSort = ['tgl_izin', 'nama_perseroan', 'nib', 'no_izin', 'kd_daerah'];
    const sortCol = allowedSort.includes(filter.sortBy) ? filter.sortBy : 'tgl_izin';
    const order = String(filter.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const rows = await dbPrimer.query(
      `SELECT
         id_export, idchecklist, tgl_izin, id_izin, jenis_izin, kd_izin,
         ur_izin_singkat, kd_daerah, nama_izin, no_izin, nib,
         tgl_permohonan, status_checklist, sts_aktif, komoditas, kbli,
         uraian_propinsi, nama_perseroan, alamat_perseroan, kelurahan_perseroan,
         perseroan_daerah_id, kode_pos_perseroan, nomor_telpon_perseroan,
         email_perusahaan, total_sesuai, total_minor, total_mayor, total_kritis,
         total_hasil, keterangan, tgl_tarik_data, sumber_data
       FROM ${TABEL}
       ${where}
       ORDER BY ${sortCol} ${order}, id_export DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const countRows = await dbPrimer.query(
      `SELECT COUNT(*) AS total FROM ${TABEL} ${where}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    return { rows, count: Number(countRows[0]?.total ?? 0) };
  }

  static async getMonthlyTrends(filter = {}) {
    const r = {};
    const effectiveFilter = {
      ...filter,
      startDate: filter.startDate || `${filter.year || new Date().getFullYear()}-01-01`,
      endDate: filter.endDate || `${filter.year || new Date().getFullYear()}-12-31`,
    };
    const where = this.#buildWhere(effectiveFilter, r);

    const rows = await dbPrimer.query(
      `SELECT MONTH(tgl_izin) AS bulan, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
       GROUP BY MONTH(tgl_izin)
       ORDER BY bulan`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = this.#buildWhere(filter, r);
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    r.limit = limit;

    const rows = await dbPrimer.query(
      `SELECT uraian_propinsi AS provinsi, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
       GROUP BY uraian_propinsi
       ORDER BY total DESC, provinsi ASC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = this.#buildWhere(filter, r);
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    r.limit = limit;

    const rows = await dbPrimer.query(
      `SELECT komoditas, COUNT(*) AS total
       FROM ${TABEL}
       ${where}
         AND komoditas IS NOT NULL
         AND TRIM(komoditas) NOT IN ('', '-')
       GROUP BY komoditas
       ORDER BY total DESC, komoditas ASC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = this.#buildWhere(filter, r);

    const page = Number.isInteger(filter.page) && filter.page > 0 ? filter.page : 1;
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    const offset = (page - 1) * limit;
    r.limit = limit;
    r.offset = offset;

    // Kolom `sortBy` tidak bisa di-bind sebagai parameter, jadi dipetakan lewat
    // whitelist. Nilai di luar daftar jatuh ke default, bukan ikut masuk SQL.
    const allowedSort = ['tgl_izin', 'nama_perseroan', 'nib', 'no_izin', 'kd_daerah'];
    const sortCol = allowedSort.includes(filter.sortBy) ? filter.sortBy : 'tgl_izin';
    const order = String(filter.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const rows = await dbPrimer.query(
      `SELECT
         id_export, idchecklist, tgl_izin, id_izin, jenis_izin, kd_izin,
         ur_izin_singkat, kd_daerah, nama_izin, no_izin, nib,
         tgl_permohonan, status_checklist, sts_aktif, komoditas, kbli,
         uraian_propinsi, nama_perseroan, alamat_perseroan, kelurahan_perseroan,
         perseroan_daerah_id, kode_pos_perseroan, nomor_telpon_perseroan,
         email_perusahaan, total_sesuai, total_minor, total_mayor, total_kritis,
         total_hasil, keterangan, tgl_tarik_data, sumber_data
       FROM ${TABEL}
       ${where}
       ORDER BY ${sortCol} ${order}, id_export DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const countRows = await dbPrimer.query(
      `SELECT COUNT(*) AS total FROM ${TABEL} ${where}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

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
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await dbKapal.query(
      `SELECT
         COUNT(id_cbib) AS totalSertifikat,
         SUM(COALESCE(gt, 0)) AS totalGT,
         SUM(COALESCE(jumlah_abk, 0)) AS totalABK,
         COUNT(CASE WHEN tgl_kadaluarsa >= CURDATE() THEN 1 END) AS totalAktif,
         NULL AS tglSyncTerakhir
       FROM tb_cbib_kapal
       ${whereClause}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const row = rows[0] ?? {};
    return {
      totalSertifikat: Number(row.totalSertifikat ?? 0),
      totalGT: Number(row.totalGT ?? 0),
      totalABK: Number(row.totalABK ?? 0),
      totalAktif: Number(row.totalAktif ?? 0),
      tglSyncTerakhir: row.tglSyncTerakhir ?? null
    };
  }
  static async getKapalMonthlyTrends(filter = {}) {
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await dbKapal.query(
      `SELECT DATE_FORMAT(tgl_terbit, '%Y-%m') AS periode, COUNT(*) AS total
       FROM tb_cbib_kapal
       ${whereClause}
       GROUP BY periode
       ORDER BY periode`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map((x) => ({ periode: x.periode, total: Number(x.total) }));
  }

  static async getKapalDistributionByGrade(filter = {}) {
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await dbKapal.query(
      `SELECT COALESCE(NULLIF(TRIM(grade_scpib), ''), 'Non Grade') AS grade,
              COUNT(*) AS total
       FROM tb_cbib_kapal
       ${whereClause}
       GROUP BY grade
       ORDER BY total DESC`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map((x) => ({ grade: x.grade, total: Number(x.total) }));
  }

  static async getKapalGTSegments(filter = {}) {
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await dbKapal.query(
      `SELECT
        SUM(CASE WHEN COALESCE(gt,0) < 10 THEN 1 ELSE 0 END) AS lt10,
        SUM(CASE WHEN COALESCE(gt,0) >= 10 AND COALESCE(gt,0) <= 30 THEN 1 ELSE 0 END) AS g10_30,
        SUM(CASE WHEN COALESCE(gt,0) >= 31 AND COALESCE(gt,0) <= 100 THEN 1 ELSE 0 END) AS g31_100,
        SUM(CASE WHEN COALESCE(gt,0) > 100 THEN 1 ELSE 0 END) AS gt100
       FROM tb_cbib_kapal
       ${whereClause}`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    const row = rows[0] ?? {};
    return {
      '<10': Number(row.lt10 ?? 0),
      '10-30': Number(row.g10_30 ?? 0),
      '31-100': Number(row.g31_100 ?? 0),
      '>100': Number(row.gt100 ?? 0)
    };
  }

  static async getKapalTopAlatTangkap(filter = {}, limit = 7) {
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    where.push("alat_tangkap IS NOT NULL");
    where.push("TRIM(alat_tangkap) <> ''");
    const whereClause = `WHERE ${where.join(' AND ')}`;
    r.limit = limit;
    const rows = await dbKapal.query(
      `SELECT TRIM(alat_tangkap) AS alat_tangkap, COUNT(*) AS total
       FROM tb_cbib_kapal
       ${whereClause}
       GROUP BY TRIM(alat_tangkap)
       ORDER BY total DESC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map((x) => ({ alat_tangkap: x.alat_tangkap, total: Number(x.total) }));
  }

  static async getKapalTopPelabuhan(filter = {}, limit = 10) {
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    where.push("nama_pelabuhan IS NOT NULL");
    where.push("TRIM(nama_pelabuhan) <> ''");
    const whereClause = `WHERE ${where.join(' AND ')}`;
    r.limit = limit;
    const rows = await dbKapal.query(
      `SELECT TRIM(nama_pelabuhan) AS nama_pelabuhan, COUNT(*) AS total
       FROM tb_cbib_kapal
       ${whereClause}
       GROUP BY TRIM(nama_pelabuhan)
       ORDER BY total DESC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map((x) => ({ nama_pelabuhan: x.nama_pelabuhan, total: Number(x.total) }));
  }

  static async getKapalSebaranWPP(filter = {}, limit = 10) {
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    where.push("daerah_tangkap IS NOT NULL");
    where.push("TRIM(daerah_tangkap) <> ''");
    const whereClause = `WHERE ${where.join(' AND ')}`;
    r.limit = limit;
    const rows = await dbKapal.query(
      `SELECT TRIM(daerah_tangkap) AS daerah_tangkap, COUNT(*) AS total
       FROM tb_cbib_kapal
       ${whereClause}
       GROUP BY TRIM(daerah_tangkap)
       ORDER BY total DESC
       LIMIT :limit`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    return rows.map((x) => ({ daerah_tangkap: x.daerah_tangkap, total: Number(x.total) }));
  }

  static async findKapalPaginated(filter = {}) {
    const where = [];
    const r = {};
    if (filter.startDate) {
      where.push('tgl_terbit BETWEEN :startDate AND :endDate');
      r.startDate = filter.startDate;
      r.endDate = filter.endDate ? `${filter.endDate} 23:59:59` : `${filter.startDate} 23:59:59`;
    } else if (filter.endDate) {
      where.push('tgl_terbit <= :endDate');
      r.endDate = `${filter.endDate} 23:59:59`;
    }
    if (filter.search) {
      where.push('(no_cbib LIKE :search OR nama_kapal LIKE :search OR nama_pemilik LIKE :search OR alat_tangkap LIKE :search OR nama_pelabuhan LIKE :search)');
      r.search = `%${String(filter.search).replace(/[\%_]/g, (c) => `\${c}`)}%`;
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const page = Number.isInteger(filter.page) && filter.page > 0 ? filter.page : 1;
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 10;
    const offset = (page - 1) * limit;
    r.limit = limit;
    r.offset = offset;

    const allowedSort = ['tgl_terbit', 'tgl_kadaluarsa', 'nama_kapal', 'gt', 'grade_scpib'];
    const sortCol = allowedSort.includes(filter.sortBy) ? filter.sortBy : 'tgl_terbit';
    const order = String(filter.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const rows = await dbKapal.query(
      `SELECT
         id_cbib, no_cbib, nama_kapal, gt, tipe_kapal, tgl_permohonan, tgl_spt,
         tgl_awal_inspeksi, tgl_akhir_inspeksi, tgl_laporan, jenis_produk, grade_scpib,
         tgl_terbit, tgl_kadaluarsa, upt_inspeksi, nama_pelabuhan, kode_provinsi,
         nama_provinsi, status_pemasok, nama_pemilik, jumlah_abk, alat_tangkap,
         daerah_tangkap, no_siup, no_kbli, pj_pusat
       FROM tb_cbib_kapal
       ${whereClause}
       ORDER BY ${sortCol} ${order}, id_cbib DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    const countRows = await dbKapal.query(
      `SELECT COUNT(*) AS total FROM tb_cbib_kapal ${whereClause}`,
      { replacements: r, type: QueryTypes.SELECT }
    );

    return { rows, count: Number(countRows[0]?.total ?? 0) };
  }

  static async getAggregatedSummary({ startDate, endDate, uptId } = {}) {
    const r = {};
    const w = [];
    if (startDate) {
      w.push('tgl_izin BETWEEN :startDate AND :endDate');
      r.startDate = startDate;
      r.endDate = endDate ? `${endDate} 23:59:59` : `${startDate} 23:59:59`;
    } else if (endDate) {
      w.push('tgl_izin <= :endDate');
      r.endDate = `${endDate} 23:59:59`;
    }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const rows = await dbPrimer.query(
      `SELECT COUNT(*) AS total FROM ${TABEL} ${where}`,
      { replacements: r, type: QueryTypes.SELECT }
    );
    const row = rows[0] ?? {};

    // Breakdown per jenis
    const [cpibRes, cbibRes, cppibRes, cpoibRes, cdoibRes, _cdoib2] = await Promise.all([
      dbPrimer.query(`SELECT COUNT(*) AS c FROM ${TABEL} ${where ? where + ' AND kd_izin' : 'WHERE kd_izin'}='032000000034'`, { replacements: r, type: QueryTypes.SELECT }), // CPIB
      dbPrimer.query(`SELECT COUNT(*) AS c FROM ${TABEL} ${where ? where + ' AND kd_izin' : 'WHERE kd_izin'}='032000000068'`, { replacements: r, type: QueryTypes.SELECT }), // CBIB
      dbPrimer.query(`SELECT COUNT(*) AS c FROM ${TABEL} ${where ? where + ' AND kd_izin' : 'WHERE kd_izin'}='032000000014'`, { replacements: r, type: QueryTypes.SELECT }), // CPPIB
      dbPrimer.query(`SELECT COUNT(*) AS c FROM ${TABEL} ${where ? where + ' AND kd_izin' : 'WHERE kd_izin'}='032000000019'`, { replacements: r, type: QueryTypes.SELECT }), // CPOIB
      dbPrimer.query(`SELECT COUNT(*) AS c FROM ${TABEL} ${where ? where + ' AND kd_izin' : 'WHERE kd_izin'}='032000000087'`, { replacements: r, type: QueryTypes.SELECT }), // CDOIB
      dbPrimer.query(`SELECT COUNT(*) AS c FROM ${TABEL} ${where ? where + ' AND kd_izin' : 'WHERE kd_izin'}='032000000036'`, { replacements: r, type: QueryTypes.SELECT })  // if needed? but we don't store
    ]).catch(() => [[],[],[],[],[]]);

    // kapal
    let cpibKapalCount = 0;
    try {
      const rw = {};
      const ww = [];
      if (startDate) { ww.push('tgl_terbit BETWEEN :startDate AND :endDate'); rw.startDate=startDate; rw.endDate=endDate?`${endDate} 23:59:59`:`${startDate} 23:59:59`; }
      else if (endDate) { ww.push('tgl_terbit <= :endDate'); rw.endDate=`${endDate} 23:59:59`; }
      const wwk = ww.length?`WHERE ${ww.join(' AND ')}`:'';
      const rk = await dbKapal.query(`SELECT COUNT(*) AS c FROM tb_cbib_kapal ${wwk}`, { replacements: rw, type: QueryTypes.SELECT });
      cpibKapalCount = Number(rk[0]?.c ?? 0);
    } catch (e) { cpibKapalCount = 0; }

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
        cpib: Number(cpibRes[0]?.c ?? 0),
        cbib: Number(cbibRes[0]?.c ?? 0),
        cppib: Number(cppibRes[0]?.c ?? 0),
        cpoib: Number(cpoibRes[0]?.c ?? 0),
        cdoib: Number(cdoibRes[0]?.c ?? 0),
        cpibKapal: cpibKapalCount
      },
      kpi: {
        totalSertifikat,
        totalPending: 0,
        detail: {
          cpib: Number(cpibRes[0]?.c ?? 0),
          cbib: Number(cbibRes[0]?.c ?? 0),
          cppib: Number(cppibRes[0]?.c ?? 0),
          cpoib: Number(cpoibRes[0]?.c ?? 0),
          cdoib: Number(cdoibRes[0]?.c ?? 0),
          cpibKapal: cpibKapalCount
        }
      }
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

export default PrimerRepository;
