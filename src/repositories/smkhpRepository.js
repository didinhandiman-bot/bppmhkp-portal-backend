import models from '../models/index.js';
import {
  buildFullUptGroupByExpression,
  buildInClause,
  expandUptCodeFilter,
  mergeUptGroups,
  sanitizeLabel,
  TRANSACTION_UPT_CODE_COLUMN,
} from '../utils/uptCode.js';

// Handle both `default export` and namespace export patterns
const modelsInstance = models?.default || models;
const { ReportEksport, sequelize, sequelizeReport } = modelsInstance || {};

if (!sequelize) {
  throw new Error('Sequelize instance not found in models/index.js — check export structure');
}

/**
 * Instan query transaksi.
 *
 * Sengaja menunjuk koneksi `report_siapmutu` (`sequelizeReport`), bukan koneksi
 * master UPT, karena seluruh query di kelas ini hanya menyentuh
 * `tr_report_ekspor`.
 */
const db = sequelizeReport ?? sequelize;

/** Prefix placeholder untuk filter kode UPT. */
const UPT_CODE_PARAM_PREFIX = 'uptCode';

class ExportRepository {

  /**
   * Helper: menormalkan tanggal filter (YYYY-MM-DD) menjadi batas rentang
   * inklusif. Kolom `tanggal_smkhp` bertipe datetime, sehingga batas akhir
   * harus diperluas sampai `23:59:59` agar seluruh baris pada hari tersebut
   * ikut terhitung.
   *
   * @param {string} value Nilai tanggal dalam format YYYY-MM-DD.
   * @param {'start'|'end'} boundary Batas rentang yang diminta.
   * @returns {string} Nilai siap pakai pada klausa SQL.
   */
  static normalizeDateBoundary(value, boundary) {
    const text = String(value ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return boundary === 'end' ? `${text} 23:59:59` : `${text} 00:00:00`;
    }
    return text;
  }

  /**
   * Helper: menyusun kondisi WHERE secara dinamis berdasarkan filters.
   *
   * Rentang tanggal memakai `tanggal_smkhp BETWEEN :startDate AND :endDate`
   * supaya pemindaian memanfaatkan indeks `idx_tanggal_smkhp` yang sudah ada.
   *
   * Filter UPT punya dua jalur:
   * - `kd_upt` (utama): dicocokkan pada kolom `kode_upt`. Nilainya dilewatkan
   *   melalui `expandUptCodeFilter`, sehingga `15.0` juga menjangkau baris
   *   `01.00` dan `01.0`. Sebaliknya permintaan `01.00` dinormalkan menjadi
   *   `15.0` beserta seluruh aliasnya.
   * - `upt` (kompatibilitas lama): pencocokan pada `nama_upt`, dipakai
   *   frontend versi sebelumnya yang mengirim nama, bukan kode. Diabaikan
   *   ketika `kd_upt` sudah diberikan agar tidak saling meniadakan.
   *
   * @param {Object} filters
   * @returns {{ whereStr: string, replacements: Object, conditions: string[] }}
   */
  static buildWhereClause(filters = {}) {
    const conditions = [];
    const replacements = {};

    if (filters.startDate && filters.endDate) {
      conditions.push('tanggal_smkhp BETWEEN :startDate AND :endDate');
      replacements.startDate = this.normalizeDateBoundary(filters.startDate, 'start');
      replacements.endDate = this.normalizeDateBoundary(filters.endDate, 'end');
    } else if (filters.startDate) {
      conditions.push('tanggal_smkhp >= :startDate');
      replacements.startDate = this.normalizeDateBoundary(filters.startDate, 'start');
    } else if (filters.endDate) {
      conditions.push('tanggal_smkhp <= :endDate');
      replacements.endDate = this.normalizeDateBoundary(filters.endDate, 'end');
    }

    // Filter UPT berbasis kode: `kd_upt` (alias `kode_upt` juga diterima).
    const requestedUptCode = sanitizeLabel(filters.kd_upt ?? filters.kode_upt);
    if (requestedUptCode !== '') {
      const codes = expandUptCodeFilter(requestedUptCode);
      const inClause = buildInClause(codes, UPT_CODE_PARAM_PREFIX, replacements);

      conditions.push(
        codes.length > 1
          ? `${TRANSACTION_UPT_CODE_COLUMN} IN (${inClause})`
          : `${TRANSACTION_UPT_CODE_COLUMN} = :${UPT_CODE_PARAM_PREFIX}0`
      );
    } else if (filters.upt !== undefined && filters.upt !== null && String(filters.upt).trim() !== '') {
      // Kolom `nama_upt` pada data sumber memuat variasi spasi/CRLF, sehingga
      // pencocokan dinormalisasi (spasi berlebih diringkas) agar dropdown dan
      // hasil filter konsisten.
      conditions.push("TRIM(REGEXP_REPLACE(nama_upt, '[[:space:]]+', ' ')) = :upt");
      replacements.upt = String(filters.upt).trim().replace(/\s+/g, ' ');
    }

    if (
      filters.negara_tujuan !== undefined &&
      filters.negara_tujuan !== null &&
      String(filters.negara_tujuan).trim() !== ''
    ) {
      conditions.push('negara_tujuan = :negara_tujuan');
      replacements.negara_tujuan = filters.negara_tujuan;
    }

    return {
      whereStr: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
      replacements,
      conditions,
    };
  }

  /**
   * Menghitung agregat untuk Hero Metric & KPI Cards.
   * Menggunakan raw SQL query untuk menghindari bug operator division di Sequelize.
   */
  static async getKpiSummary(filters = {}) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    const sql = `
      SELECT
        COALESCE(SUM(nilai_rupiah), 0) AS totalNilaiRupiah,
        COALESCE(SUM( CASE WHEN kurs_usd IS NOT NULL AND kurs_usd > 0 THEN nilai_rupiah / kurs_usd ELSE 0 END ), 0) AS totalNilaiUsd,
        COALESCE(SUM(netto), 0) AS totalNettoKg,
        COUNT(DISTINCT nomor_aju) AS totalDokumenAju,
        COUNT(DISTINCT no_hc) AS totalSertifikatHc,
        COUNT(DISTINCT nama_upi) AS totalUpiAktif,
        COUNT(DISTINCT nama_trader) AS totalTraderAktif,
        COUNT(DISTINCT negara_tujuan) AS totalNegaraTujuan
      FROM tr_report_ekspor
      ${whereStr}
    `;

    const results = await db.query(sql, {
      replacements,
      type: db.QueryTypes.SELECT,
      raw: true,
    });

    if (!Array.isArray(results) || results.length === 0) {
      return {
        totalNilaiRupiah: 0,
        totalNilaiUsd: 0,
        totalNettoKg: 0,
        totalDokumenAju: 0,
        totalSertifikatHc: 0,
        totalUpiAktif: 0,
        totalTraderAktif: 0,
        totalNegaraTujuan: 0,
      };
    }

    return results[0];
  }

  /**
   * Total nilai rupiah saja untuk sebuah rentang filter.
   * Dipakai menghitung pembanding Year-over-Year secara efisien.
   */
  static async getTotalNilaiRupiah(filters = {}) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    const sql = `
      SELECT COALESCE(SUM(nilai_rupiah), 0) AS totalNilaiRupiah
      FROM tr_report_ekspor
      ${whereStr}
    `;

    const results = await db.query(sql, {
      replacements,
      type: db.QueryTypes.SELECT,
      raw: true,
    });

    return (Array.isArray(results) && results[0]) || { totalNilaiRupiah: 0 };
  }

  /**
   * Daftar DISTINCT nama UPT dari tabel transaksi.
   *
   * Endpoint ini dipertahankan untuk kompatibilitas frontend lama. Opsi filter
   * yang direkomendasikan kini berasal dari master `hc.tb_r_upt` melalui
   * `GET /api/v1/options/upt`, karena hanya master yang memuat kode unit.
   */
  static async getUpts() {
    const sql = `
      SELECT DISTINCT TRIM(REGEXP_REPLACE(nama_upt, '[[:space:]]+', ' ')) AS nama_upt
      FROM tr_report_ekspor
      WHERE nama_upt IS NOT NULL
        AND TRIM(REGEXP_REPLACE(nama_upt, '[[:space:]]+', ' ')) <> ''
      ORDER BY nama_upt ASC
    `;

    const results = await db.query(sql, {
      type: db.QueryTypes.SELECT,
      raw: true,
    });

    return Array.isArray(results) ? results : [];
  }

  /**
   * Agregasi per UPT (`GROUP BY kode_upt`) dengan bucket alias digabung.
   *
   * `01.0` dan `01.00` dilaporkan sebagai `15.0` di dalam SQL lewat ekspresi
   * `CASE … WHEN`, sehingga `SUM(netto)`, `SUM(nilai_rupiah)`, dan
   * `COUNT(DISTINCT nomor_aju)` terakumulasi pada satu baris. Hasilnya
   * selesai di database (satu kali pemindaian) dan frontend tidak pernah
   * menerima dua baris dengan `nama_upt` yang sama.
   *
   * Kolom `nama_upt` sengaja tidak diambil: nama UPT berasal dari database
   * `hc`, jadi harus diisi ulang di level service (lihat `UptMasterService`).
   *
   * @param {Object} filters Filter aktif (tanggal, negara tujuan, UPT).
   * @returns {Promise<object[]>} Baris agregat per kode UPT utama.
   */
  static async getUptBreakdown(filters = {}) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    const groupedCode = buildFullUptGroupByExpression(
      `TRIM(${TRANSACTION_UPT_CODE_COLUMN})`,
      replacements
    );

    const sql = `
      SELECT
        ${groupedCode} AS kode_upt,
        COALESCE(SUM(netto), 0) AS totalNettoKg,
        COALESCE(SUM(nilai_rupiah), 0) AS totalNilaiRupiah,
        COUNT(DISTINCT nomor_aju) AS totalDokumenAju
      FROM tr_report_ekspor
      ${whereStr}
      GROUP BY ${groupedCode}
      ORDER BY totalNilaiRupiah DESC
    `;

    const results = await db.query(sql, {
      replacements,
      type: db.QueryTypes.SELECT,
      raw: true,
    });

    const rows = Array.isArray(results) ? results : [];

    // Jaring pengaman: bila driver/MariaDB menolak `GROUP BY <expr>` yang
    // diulang, hasil yang terpecah tetap digabung di memori.
    return mergeUptGroups(rows, 'kode_upt', ['totalNettoKg', 'totalNilaiRupiah', 'totalDokumenAju']);
  }

  /**
   * Baris granular (negara tujuan × komoditas) untuk matriks ekspor.
   *
   * Menyajikan nilai devisa USD per kombinasi `negara_tujuan`-`kel_ikan`
   * dalam satu pemindaian. Nilai USD dihitung dari `nilai_rupiah / kurs_usd`
   * (tabel tidak memuat kolom `nilai_usd`; cara ini konsisten dengan KPI).
   *
   * Pengelompokan negara/komoditas ke "ASEAN", "Uni Eropa", "Udang", dsb.
   * dilakukan di level service (`exportGrouping.js`) karena variasi ejaan di
   * database hanya bisa ditangani secara deterministik di memori, sementara
   * WHERE tetap memanfaatkan kolom terindeks (`tanggal_smkhp`, `kode_upt`).
   *
   * @param {Object} filters Filter aktif (tanggal, UPT, negara tujuan).
   * @returns {Promise<object[]>} Baris `{ negara_tujuan, kel_ikan, value_usd }`.
   */
  static async getMatrixGranular(filters = {}) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    const sql = `
      SELECT
        negara_tujuan,
        kel_ikan,
        COALESCE(
          SUM(CASE WHEN kurs_usd IS NOT NULL AND kurs_usd > 0 THEN nilai_rupiah / kurs_usd ELSE 0 END),
          0
        ) AS value_usd
      FROM tr_report_ekspor
      ${whereStr}
      GROUP BY negara_tujuan, kel_ikan
    `;

    const results = await db.query(sql, {
      replacements,
      type: db.QueryTypes.SELECT,
      raw: true,
    });

    return Array.isArray(results) ? results : [];
  }

  /**
   * Tren pergerakan bulanan.
   */
  static async getMonthlyTrends(filters = {}) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    const sql = `
      SELECT
        bulan,
        SUM(netto) AS totalNettoKg,
        SUM(nilai_rupiah) AS totalNilaiRupiah,
        COUNT(DISTINCT no_hc) AS totalDokumenHc
      FROM tr_report_ekspor
      ${whereStr}
      GROUP BY bulan
      ORDER BY MIN(tanggal_smkhp) ASC
    `;

    const results = await db.query(sql, {
      replacements,
      type: db.QueryTypes.SELECT,
      raw: true,
    });

    return results;
  }

  /**
   * Negara tujuan ekspor terbesar.
   */
  static async getTopDestinations(filters = {}, limit = 5) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    const sql = `
      SELECT
        kode_negara_partner,
        negara_tujuan,
        SUM(nilai_rupiah) AS totalNilaiRupiah,
        SUM(netto) AS totalNettoKg
      FROM tr_report_ekspor
      ${whereStr}
      GROUP BY kode_negara_partner, negara_tujuan
      ORDER BY totalNilaiRupiah DESC
      LIMIT :limit
    `;

    const results = await db.query(sql, {
      replacements: { ...replacements, limit: parseInt(limit, 10) },
      type: db.QueryTypes.SELECT,
      raw: true,
    });

    return results;
  }

  /**
   * Analisis komoditas: rasio asal (tawar/laut), peruntukan (konsumsi), top kelompok ikan.
   */
  static async getCommodityAnalytics(filters = {}) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    // Parallel queries
    const [rasioTawarLaut, rasioKonsumsi, topKomoditas] = await Promise.all([
      // a. Rasio Asal Komoditas (tawar_laut)
      db.query(`
        SELECT tawar_laut, SUM(netto) AS totalNettoKg
        FROM tr_report_ekspor
        ${whereStr}
        GROUP BY tawar_laut
      `, {
        replacements,
        type: db.QueryTypes.SELECT,
        raw: true,
      }),

      // b. Rasio Peruntukan (konsumsi)
      db.query(`
        SELECT konsumsi, SUM(netto) AS totalNettoKg
        FROM tr_report_ekspor
        ${whereStr}
        GROUP BY konsumsi
      `, {
        replacements,
        type: db.QueryTypes.SELECT,
        raw: true,
      }),

      // c. Top 5 Kelompok Ikan
      db.query(`
        SELECT kel_ikan, SUM(netto) AS totalNettoKg, SUM(nilai_rupiah) AS totalNilaiRupiah
        FROM tr_report_ekspor
        ${whereStr}
        GROUP BY kel_ikan
        ORDER BY totalNettoKg DESC
        LIMIT 5
      `, {
        replacements,
        type: db.QueryTypes.SELECT,
        raw: true,
      }),
    ]);

    return {
      rasioTawarLaut,
      rasioKonsumsi,
      topKomoditas,
    };
  }

  /**
   * Cache sederhana untuk total record (COUNT).
   *
   * `COUNT(DISTINCT nomor_aju)` menyentuh ratusan ribu baris dan hasilnya jarang
   * berubah, sedangkan nilainya dibutuhkan pada setiap pergantian halaman.
   * Cache berbasis TTL ini menghindari pengulangan pemindaian penuh.
   */
  static #countCache = new Map();

  /** Masa berlaku cache count (ms); dapat diatur lewat env. */
  static get countCacheTtlMs() {
    const raw = Number.parseInt(process.env.TRANSACTIONS_COUNT_CACHE_TTL_MS ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 300_000;
  }

  /** Mengambil total dari cache bila masih berlaku. */
  static #readCountCache(key) {
    const cached = ExportRepository.#countCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.at > ExportRepository.countCacheTtlMs) {
      ExportRepository.#countCache.delete(key);
      return null;
    }
    return cached.value;
  }

  /** Menyimpan total ke cache. */
  static #writeCountCache(key, value) {
    ExportRepository.#countCache.set(key, { value, at: Date.now() });
  }

  /** Mengosongkan cache total (dipakai saat data sumber diperbarui). */
  static clearTransactionsCountCache() {
    ExportRepository.#countCache.clear();
  }

  /**
   * Daftar log pengajuan tabular dengan paginasi dan pencarian.
   *
   * Optimasi (Siklus 4 lanjutan):
   * - `SELECT DISTINCT` dihapus: tabel menyimpan satu baris per item komoditas
   *   (satu nomor dokumen bisa memiliki puluhan baris), sehingga DISTINCT pada
   *   seluruh kolom memaksa `Using temporary; Using filesort` atas 346k baris
   *   tanpa menghilangkan duplikat nyata secara bermakna.
   * - `ORDER BY` dibuat deterministik dengan tiebreaker `nomor_aju DESC`,
   *   didukung indeks `idx_tanggal_smkhp (tanggal_smkhp DESC, nomor_aju DESC)`
   *   sehingga pengurutan terbaca langsung dari indeks (tanpa filesort).
   * - `COUNT` dipisahkan dari query data, dijalankan paralel, dan di-cache TTL.
   */
  static async getTransactions(filters, { page = 1, limit = 10, search = '' } = {}) {
    const { whereStr, replacements } = this.buildWhereClause(filters);

    // Search condition.
    // Mencakup eksportir/UPI serta komoditas ikan, sesuai placeholder pada
    // kolom pencarian di UI ("Cari eksportir atau komoditas ikan...").
    let finalWhere = whereStr;
    if (search && String(search).trim() !== '') {
      const likeSearch = `%${String(search).trim()}%`;
      replacements.search = likeSearch;
      finalWhere += `${finalWhere ? ' AND' : 'WHERE'} ((nomor_aju LIKE :search) OR (no_hc LIKE :search)` +
        ' OR (nama_upi LIKE :search) OR (nama_trader LIKE :search)' +
        ' OR (kel_ikan LIKE :search) OR (nm_dagang LIKE :search) OR (nm_latin LIKE :search))';
    }

    const offset = (page - 1) * limit;

    // Kunci cache mengikuti kombinasi filter (tanpa paginasi, karena total tidak
    // berubah saat berpindah halaman).
    const countCacheKey = finalWhere + '|' + JSON.stringify(replacements);
    const cachedTotal = ExportRepository.#readCountCache(countCacheKey);

    /** Query total record; dilewati sepenuhnya bila cache masih berlaku. */
    const countPromise = cachedTotal !== null
      ? Promise.resolve(cachedTotal)
      : db
          .query(`SELECT COUNT(DISTINCT nomor_aju) AS total FROM tr_report_ekspor ${finalWhere}`, {
            replacements,
            type: db.QueryTypes.SELECT,
            raw: true,
          })
          .then((rows) => {
            const total = Number((Array.isArray(rows) && rows[0]?.total) || 0);
            ExportRepository.#writeCountCache(countCacheKey, total);
            return total;
          });

    // Query data: tanpa DISTINCT, urutan deterministik, memanfaatkan indeks.
    const dataPromise = db.query(
      `SELECT *
       FROM tr_report_ekspor
       ${finalWhere}
       ORDER BY tanggal_smkhp DESC, nomor_aju DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements: { ...replacements, limit, offset },
        type: db.QueryTypes.SELECT,
        raw: true,
      },
    );

    // Kedua query dijalankan bersamaan agar latensi = query terlama, bukan jumlahnya.
    const [total, dataResults] = await Promise.all([countPromise, dataPromise]);
    const totalRecords = Number(total) || 0;

    return {
      data: Array.isArray(dataResults) ? dataResults : [],
      meta: {
        total: totalRecords,
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit),
        countCached: cachedTotal !== null,
      },
    };
  }
}

export default ExportRepository;
