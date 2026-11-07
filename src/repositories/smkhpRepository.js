import { literal } from 'sequelize';
import { ReportEksport } from '../models/index.js';
import {
  buildFullUptGroupByExpression,
  buildInClause,
  expandUptCodeFilter,
  mergeUptGroups,
  sanitizeLabel,
  TRANSACTION_UPT_CODE_COLUMN,
} from '../utils/uptCode.js';

/** Prefix placeholder untuk filter kode UPT. */
const UPT_CODE_PARAM_PREFIX = 'uptCode';

/**
 * Rakit kondisi (tanpa kata kunci `WHERE`) menjadi opsi `where` + `replacements`
 * siap pakai pada `Model.findAll`.
 *
 * Generator Sequelize menambahkan `WHERE` sendiri, sehingga menyertakannya di
 * literal akan menghasilkan `WHERE WHERE ...`. Seluruh nilai pengguna tetap
 * berada di `replacements`, bukan di dalam string SQL.
 *
 * @param {string[]} conditions Fragmen kondisi yang disambung `AND`.
 * @param {Record<string, unknown>} replacements Nilai binding yang sudah diisi.
 * @returns {object} Opsi tambahan untuk dipadankan ke options Model.
 */
function whereOptions(conditions, replacements) {
  return conditions.length
    ? { where: literal(conditions.join(' AND ')), replacements }
    : { replacements };
}

/**
 * Repository transaksi ekspor (SMKHP) — `report_siapmutu.tr_report_ekspor`.
 *
 * SELURUH pembacaan dieksekusi lewat Model Sequelize `ReportEksport`
 * (Model-First Standard): `findAll` untuk baris/agregasi ber-alias dan
 * `raw: true` agar alias non-atribut tidak hilang. Tidak ada lagi
 * `db.query('SELECT ... FROM tr_report_ekspor')` dengan string nama tabel.
 *
 * Nilai dari pengguna selalu lewat `replacements`; tidak ada interpolasi nilai
 * ke SQL. Literal yang disisipkan hanya nama kolom/ekspresi internal dan
 * fragmen kondisi yang seluruh nilainya sudah dibinding.
 */
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
   */
  static async getKpiSummary(filters = {}) {
    const { conditions, replacements } = this.buildWhereClause(filters);

    const rows = await ReportEksport.findAll({
      attributes: [
        [literal('COALESCE(SUM(nilai_rupiah), 0)'), 'totalNilaiRupiah'],
        [literal('COALESCE(SUM( CASE WHEN kurs_usd IS NOT NULL AND kurs_usd > 0 THEN nilai_rupiah / kurs_usd ELSE 0 END ), 0)'), 'totalNilaiUsd'],
        [literal('COALESCE(SUM(netto), 0)'), 'totalNettoKg'],
        [literal('COUNT(DISTINCT nomor_aju)'), 'totalDokumenAju'],
        [literal('COUNT(DISTINCT no_hc)'), 'totalSertifikatHc'],
        [literal('COUNT(DISTINCT nama_upi)'), 'totalUpiAktif'],
        [literal('COUNT(DISTINCT nama_trader)'), 'totalTraderAktif'],
        [literal('COUNT(DISTINCT negara_tujuan)'), 'totalNegaraTujuan'],
      ],
      ...whereOptions(conditions, replacements),
      raw: true,
    });

    if (!Array.isArray(rows) || rows.length === 0) {
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

    return rows[0];
  }

  /**
   * Total nilai rupiah saja untuk sebuah rentang filter.
   * Dipakai menghitung pembanding Year-over-Year secara efisien.
   */
  static async getTotalNilaiRupiah(filters = {}) {
    const { conditions, replacements } = this.buildWhereClause(filters);

    const rows = await ReportEksport.findAll({
      attributes: [[literal('COALESCE(SUM(nilai_rupiah), 0)'), 'totalNilaiRupiah']],
      ...whereOptions(conditions, replacements),
      raw: true,
    });

    return (Array.isArray(rows) && rows[0]) || { totalNilaiRupiah: 0 };
  }

  /**
   * Daftar DISTINCT nama UPT dari tabel transaksi.
   *
   * Endpoint ini dipertahankan untuk kompatibilitas frontend lama. Opsi filter
   * yang direkomendasikan kini berasal dari master `hc.tb_r_upt` melalui
   * `GET /api/v1/options/upt`, karena hanya master yang memuat kode unit.
   */
  static async getUpts(filters = {}) {
    const { conditions, replacements } = this.buildWhereClause(filters);
    const normalizedName = "TRIM(REGEXP_REPLACE(nama_upt, '[[:space:]]+', ' '))";

    // DISTINCT atas ekspresi setara dengan GROUP BY ekspresi yang sama.
    const allConditions = [
      ...conditions,
      'nama_upt IS NOT NULL',
      `${normalizedName} <> ''`,
    ];

    const rows = await ReportEksport.findAll({
      attributes: [[literal(normalizedName), 'nama_upt']],
      ...whereOptions(allConditions, replacements),
      group: [literal(normalizedName)],
      order: [[literal('nama_upt'), 'ASC']],
      raw: true,
    });

    return Array.isArray(rows) ? rows : [];
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
    const { conditions, replacements } = this.buildWhereClause(filters);

    const groupedCode = buildFullUptGroupByExpression(
      `TRIM(${TRANSACTION_UPT_CODE_COLUMN})`,
      replacements
    );

    const rows = await ReportEksport.findAll({
      attributes: [
        [literal(groupedCode), 'kode_upt'],
        [literal('COALESCE(SUM(netto), 0)'), 'totalNettoKg'],
        [literal('COALESCE(SUM(nilai_rupiah), 0)'), 'totalNilaiRupiah'],
        [literal('COUNT(DISTINCT nomor_aju)'), 'totalDokumenAju'],
      ],
      ...whereOptions(conditions, replacements),
      group: [literal(groupedCode)],
      order: [[literal('totalNilaiRupiah'), 'DESC']],
      raw: true,
    });

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
    const { conditions, replacements } = this.buildWhereClause(filters);

    const rows = await ReportEksport.findAll({
      attributes: [
        'negara_tujuan',
        'kel_ikan',
        [literal('COALESCE(SUM(CASE WHEN kurs_usd IS NOT NULL AND kurs_usd > 0 THEN nilai_rupiah / kurs_usd ELSE 0 END), 0)'), 'value_usd'],
      ],
      ...whereOptions(conditions, replacements),
      group: ['negara_tujuan', 'kel_ikan'],
      raw: true,
    });

    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Tren pergerakan bulanan.
   */
  static async getMonthlyTrends(filters = {}) {
    const { conditions, replacements } = this.buildWhereClause(filters);

    const rows = await ReportEksport.findAll({
      attributes: [
        'bulan',
        [literal('SUM(netto)'), 'totalNettoKg'],
        [literal('SUM(nilai_rupiah)'), 'totalNilaiRupiah'],
        [literal('COUNT(DISTINCT no_hc)'), 'totalDokumenHc'],
      ],
      ...whereOptions(conditions, replacements),
      group: ['bulan'],
      order: [[literal('MIN(tanggal_smkhp)'), 'ASC']],
      raw: true,
    });

    return rows;
  }

  /**
   * Negara tujuan ekspor terbesar.
   */
  static async getTopDestinations(filters = {}, limit = 5) {
    const { conditions, replacements } = this.buildWhereClause(filters);

    const rows = await ReportEksport.findAll({
      attributes: [
        'kode_negara_partner',
        'negara_tujuan',
        [literal('SUM(nilai_rupiah)'), 'totalNilaiRupiah'],
        [literal('SUM(netto)'), 'totalNettoKg'],
      ],
      ...whereOptions(conditions, replacements),
      group: ['kode_negara_partner', 'negara_tujuan'],
      order: [[literal('totalNilaiRupiah'), 'DESC']],
      limit: parseInt(limit, 10),
      raw: true,
    });

    return rows;
  }

  /**
   * Analisis komoditas: rasio asal (tawar/laut), peruntukan (konsumsi), top kelompok ikan.
   */
  static async getCommodityAnalytics(filters = {}) {
    const { conditions, replacements } = this.buildWhereClause(filters);

    const [rasioTawarLaut, rasioKonsumsi, topKomoditas] = await Promise.all([
      // a. Rasio Asal Komoditas (tawar_laut)
      ReportEksport.findAll({
        attributes: [
          'tawar_laut',
          [literal('SUM(netto)'), 'totalNettoKg'],
        ],
        ...whereOptions(conditions, { ...replacements }),
        group: ['tawar_laut'],
        raw: true,
      }),

      // b. Rasio Peruntukan (konsumsi)
      ReportEksport.findAll({
        attributes: [
          'konsumsi',
          [literal('SUM(netto)'), 'totalNettoKg'],
        ],
        ...whereOptions(conditions, { ...replacements }),
        group: ['konsumsi'],
        raw: true,
      }),

      // c. Top 5 Kelompok Ikan
      ReportEksport.findAll({
        attributes: [
          'kel_ikan',
          [literal('SUM(netto)'), 'totalNettoKg'],
          [literal('SUM(nilai_rupiah)'), 'totalNilaiRupiah'],
        ],
        ...whereOptions(conditions, { ...replacements }),
        group: ['kel_ikan'],
        order: [[literal('totalNettoKg'), 'DESC']],
        limit: 5,
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
    const { conditions, replacements } = this.buildWhereClause(filters);

    // Search condition.
    // Mencakup eksportir/UPI serta komoditas ikan, sesuai placeholder pada
    // kolom pencarian di UI ("Cari eksportir atau komoditas ikan...").
    if (search && String(search).trim() !== '') {
      const likeSearch = `%${String(search).trim()}%`;
      replacements.search = likeSearch;
      conditions.push(
        '((nomor_aju LIKE :search) OR (no_hc LIKE :search)' +
        ' OR (nama_upi LIKE :search) OR (nama_trader LIKE :search)' +
        ' OR (kel_ikan LIKE :search) OR (nm_dagang LIKE :search) OR (nm_latin LIKE :search))'
      );
    }

    const offset = (page - 1) * limit;

    // Kunci cache mengikuti kombinasi filter (tanpa paginasi, karena total tidak
    // berubah saat berpindah halaman).
    const countCacheKey = conditions.join(' AND ') + '|' + JSON.stringify(replacements);
    const cachedTotal = ExportRepository.#readCountCache(countCacheKey);

    /** Query total record; dilewati sepenuhnya bila cache masih berlaku. */
    const countPromise = cachedTotal !== null
      ? Promise.resolve(cachedTotal)
      : ReportEksport.findAll({
          attributes: [[literal('COUNT(DISTINCT nomor_aju)'), 'total']],
          ...whereOptions(conditions, replacements),
          raw: true,
        }).then((rows) => {
          const total = Number((Array.isArray(rows) && rows[0]?.total) || 0);
          ExportRepository.#writeCountCache(countCacheKey, total);
          return total;
        });

    // Query data: tanpa DISTINCT, urutan deterministik, memanfaatkan indeks.
    const dataPromise = ReportEksport.findAll({
      ...whereOptions(conditions, replacements),
      order: [['tanggal_smkhp', 'DESC'], ['nomor_aju', 'DESC']],
      limit,
      offset,
      raw: true,
    });

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
