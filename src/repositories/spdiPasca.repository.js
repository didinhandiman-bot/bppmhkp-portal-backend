import { literal, Op } from 'sequelize';
import { TbSpdiPasca } from '../models/index.js';
import { getYearRange } from '../utils/skpGrouping.js';
import {
  TEST_UPT_CODES,
  buildFullUptGroupByExpression,
  buildInClause,
  expandUptCodeFilter,
} from '../utils/uptCode.js';

/**
 * Repository Modul SPDI Pascapanen.
 *
 * Tanggung jawab HANYA komunikasi database: menyusun klausa filter, mengirim
 * `replacements`, dan mengembalikan baris mentah hasil agregasi. Perhitungan
 * bisnis (frekuensi KBLI, metadata paginasi, pengelompokan "Lainnya") milik
 * service.
 *
 * Model-First Standard: seluruh pembacaan lewat `TbSpdiPasca` (`findAll`,
 * `findAndCountAll`) — tidak ada `db.query()` dan tidak ada nama tabel string.
 * Agregasi memakai `sequelize.literal()` + `attributes` ber-alias, dan SELURUH
 * nilai dari pengguna lewat `replacements`; tidak ada interpolasi nilai ke SQL.
 *
 * PERHATIAN Model-First: klausa `WHERE` tidak boleh ditulis di dalam string
 * literal — generator Sequelize menambahkannya sendiri, sehingga menulis
 * `'WHERE ...'` menghasilkan `WHERE WHERE ...`. Lihat `#whereLiteral()`.
 *
 * Penyeragaman kode UPT mengikuti aturan proyek (`utils/uptCode.js`): ekspresi
 * filter, `GROUP BY`, dan exclusion data uji dibangun dari helper yang sama
 * agar satu unit tidak muncul sebagai dua baris berlabel identik.
 *
 * Model terikat ke koneksi `report_spdi`, jadi SQL tidak di-prefix nama skema.
 * Jangan menambahkan JOIN ke `hc`, `report_siapmutu`, atau skema report lain.
 */
class SpdiPascaRepository {
  /**
   * Klausa filter bersama untuk seluruh query dashboard dan daftar.
   *
   * `tahun` sengaja membolehkan dua sumber tanggal (permohonan ATAU terbit),
   * karena sebagian permohonan belum terbit sehingga hanya punya
   * `tgl_permohonan`. Bentuk rentang (`>= :start AND < :endNext`) dipakai
   * alih-alih `YEAR(...)` supaya tidak membungkus kolom dan tetap sargable.
   *
   * Kode UPT uji (`98.0`/`99.0`) selalu dikecualikan supaya tidak ikut
   * menghitung metrik; `COALESCE` menjaga baris berkod kosong tetap lolos
   * karena predikat `NOT IN` pada MySQL membuang baris NULL.
   *
   * @param {Object} filter Filter `{ kdUpt, kdProvinsi, tahun }`.
   * @param {boolean} [terbitOnly] `true` bila hanya baris ber-`tgl_terbit` yang dihitung.
   * @returns {{conditions: string[], replacements: Object}}
   */
  static #buildConditions(filter = {}, terbitOnly = false) {
    const conditions = [];
    const replacements = {};

    if (terbitOnly) {
      conditions.push('tgl_terbit IS NOT NULL');
    }

    if (filter.kdUpt) {
      const codes = expandUptCodeFilter(filter.kdUpt);
      const inClause = buildInClause(codes, 'upt', replacements);
      if (inClause) {
        conditions.push(`TRIM(kd_upt) IN (${inClause})`);
      }
    }

    if (filter.kdProvinsi) {
      conditions.push('TRIM(kd_provinsi) = :kdProvinsi');
      replacements.kdProvinsi = filter.kdProvinsi;
    }

    if (filter.tahun) {
      const range = getYearRange(filter.tahun);
      conditions.push(`(
        (tgl_permohonan >= :tahunStart AND tgl_permohonan < :tahunEnd)
        OR (tgl_terbit >= :tahunStart AND tgl_terbit < :tahunEnd)
      )`);
      replacements.tahunStart = range.start;
      replacements.tahunEnd = range.endNext;
    }

    const testClause = buildInClause(TEST_UPT_CODES, 'testUpt', replacements);
    if (testClause) {
      conditions.push(`COALESCE(TRIM(kd_upt), '') NOT IN (${testClause})`);
    }

    return { conditions, replacements };
  }

  /**
   * Merakit daftar kondisi menjadi literal untuk opsi `where` Model.
   *
   * Sengaja TANPA kata kunci `WHERE` (generator Sequelize yang menambahkannya).
   * Array kosong dikembalikan sebagai `undefined` supaya tidak mengirim
   * literal kosong pada query tanpa filter.
   *
   * @param {string[]} conditions Kondisi hasil `#buildConditions`.
   * @returns {import('sequelize').Literal|undefined} Literal kondisi ter-AND.
   */
  static #whereLiteral(conditions) {
    if (!conditions.length) {
      return undefined;
    }
    return literal(conditions.join(' AND '));
  }

  /**
   * Escape wildcard `LIKE` untuk pencarian bebas.
   *
   * Nilai mentah bisa mengandung `%` atau `_` yang berarti wildcard; tanpa
   * escaping, pencarian "100%" akan mencocokkan seluruh baris. Backslash adalah
   * karakter escape default MySQL pada klausa `LIKE`.
   *
   * @param {string} value Kata kunci dari query string.
   * @returns {string} Pola `%…%` siap pakai pada `Op.like`.
   */
  static #likePattern(value) {
    const escaped = String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
    return `%${escaped}%`;
  }

  /**
   * Metrik ringkasan: total data, total terbit, rata-rata skor, dan rata-rata
   * SLA terbit.
   *
   * Keenam angka dihitung dalam SATU pass tabel lewat `findAll` ber-alias —
   * `Model.count()` hanya menghasilkan satu angka. SLA memakai
   * `AVG(DATEDIFF(tgl_terbit, tgl_permohonan))`: MySQL mengabaikan NULL dalam
   * `AVG`, dan `DATEDIFF` menghasilkan NULL bila `tgl_terbit` belum diisi,
   * sehingga baris belum terbit otomatis tidak ikut merataratakan SLA tanpa
   * perlu mempersempit `WHERE` (total & rata-rata skor tetap menghitung
   * seluruh baris).
   *
   * @param {Object} filter Filter `{ kdUpt, kdProvinsi, tahun }`.
   * @returns {Promise<Object>} Agregasi mentah (angka masih string dari MySQL).
   */
  static async getSummaryMetrics(filter = {}) {
    const { conditions, replacements } = SpdiPascaRepository.#buildConditions(filter);

    const rows = await TbSpdiPasca.findAll({
      attributes: [
        [literal('COUNT(id)'), 'totalData'],
        [literal('COUNT(tgl_terbit)'), 'totalTerbit'],
        [literal('ROUND(AVG(skor_inspeksi), 2)'), 'avgSkorInspeksi'],
        [literal('ROUND(AVG(skor_cdib), 2)'), 'avgSkorCdib'],
        [literal('ROUND(AVG(DATEDIFF(tgl_terbit, tgl_permohonan)), 2)'), 'avgSlaHari'],
        [literal("COUNT(DISTINCT COALESCE(NULLIF(TRIM(nama_unit), ''), CONCAT('ID-', id)))"), 'totalUnit'],
      ],
      where: SpdiPascaRepository.#whereLiteral(conditions),
      replacements,
      // Tanpa `raw`, alias yang bukan atribut model hilang karena Sequelize
      // membangun instance Model dari hasil.
      raw: true,
    });

    return rows[0] || {};
  }

  /**
   * Jumlah sertifikat terbit per bulan, mengabaikan baris belum terbit.
   *
   * Bulan dikembalikan sebagai `YYYY-MM` (bukan `MONTH()` saja) agar dua tahun
   * tidak pernah runtuh menjadi satu bulan ketika filter `tahun` tidak dipakai.
   *
   * @param {Object} filter Filter `{ kdUpt, kdProvinsi, tahun }`.
   * @returns {Promise<Array<{bulan: string, total: number|string}>>}
   */
  static async getMonthlyTrend(filter = {}) {
    const { conditions, replacements } = SpdiPascaRepository.#buildConditions(filter, true);

    const rows = await TbSpdiPasca.findAll({
      attributes: [
        [literal("DATE_FORMAT(tgl_terbit, '%Y-%m')"), 'bulan'],
        [literal('COUNT(id)'), 'total'],
      ],
      where: SpdiPascaRepository.#whereLiteral(conditions),
      group: [literal("DATE_FORMAT(tgl_terbit, '%Y-%m')")],
      order: [[literal('bulan'), 'ASC']],
      replacements,
      raw: true,
    });

    return rows;
  }

  /**
   * Kontribusi per UPT: jumlah unit beserta rata-rata skor.
   *
   * `GROUP BY` memakai `buildFullUptGroupByExpression` sehingga alias lama
   * (`01.0`/`01.00`) melebur ke kode utama (`15.0`) di level database. Label
   * diambil dari `MAX(nama_upt)` sesuai spesifikasi: satu kode = satu label,
   * dan `MAX` memilih varian yang paling stabil secara alfabetis.
   *
   * @param {Object} filter Filter `{ kdUpt, kdProvinsi, tahun }`.
   * @returns {Promise<Array<Object>>} Baris agregasi per kode UPT.
   */
  static async getByUpt(filter = {}) {
    const { conditions, replacements } = SpdiPascaRepository.#buildConditions(filter);
    const uptReplacements = { ...replacements };
    const groupExpression = buildFullUptGroupByExpression('TRIM(kd_upt)', uptReplacements);

    const rows = await TbSpdiPasca.findAll({
      attributes: [
        [literal(groupExpression), 'kd_upt'],
        [literal('MAX(nama_upt)'), 'nama_upt'],
        [literal('COUNT(id)'), 'total'],
        [literal('ROUND(AVG(skor_inspeksi), 2)'), 'avgSkorInspeksi'],
        [literal('ROUND(AVG(skor_cdib), 2)'), 'avgSkorCdib'],
      ],
      where: SpdiPascaRepository.#whereLiteral(conditions),
      group: [literal(groupExpression)],
      order: [[literal('total'), 'DESC'], [literal('kd_upt'), 'ASC']],
      replacements: uptReplacements,
      raw: true,
    });

    return rows;
  }

  /**
   * Sebaran per provinsi untuk kebutuhan peta GeoJSON.
   *
   * `MAX(provinsi)` ikut diambil sebagai label cadangan karena isi kolomnya
   * berupa teks bebas ("KAB. BUNGO, JAMBI"), sedangkan frontend memetakan
   * polygon dari `kd_provinsi`.
   *
   * @param {Object} filter Filter `{ kdUpt, kdProvinsi, tahun }`.
   * @returns {Promise<Array<{kd_provinsi: string, nama_provinsi: string|null, total: number|string}>>}
   */
  static async getByProvinsi(filter = {}) {
    const { conditions, replacements } = SpdiPascaRepository.#buildConditions(filter);

    const rows = await TbSpdiPasca.findAll({
      attributes: [
        [literal('TRIM(kd_provinsi)'), 'kd_provinsi'],
        [literal('MAX(provinsi)'), 'nama_provinsi'],
        [literal('COUNT(id)'), 'total'],
      ],
      where: SpdiPascaRepository.#whereLiteral(
        [...conditions, "COALESCE(TRIM(kd_provinsi), '') <> ''"]
      ),
      group: [literal('TRIM(kd_provinsi)')],
      order: [[literal('total'), 'DESC'], [literal('kd_provinsi'), 'ASC']],
      replacements,
      raw: true,
    });

    return rows;
  }

  /**
   * Ambil seluruh nilai `kbli` mentah untuk dihitung di service.
   *
   * Repository TIDAK memecah string koma: satu baris bisa memuat
   * `"47215, 52102"` dan frekuensi per kode adalah aturan bisnis yang tinggal
   * di service, bukan di SQL. Baris NULL/kosong disaring di sini supaya
   * service tidak membawa sampah.
   *
   * @param {Object} filter Filter `{ kdUpt, kdProvinsi, tahun }`.
   * @returns {Promise<Array<{kbli: string}>>}
   */
  static async getAllKbli(filter = {}) {
    const { conditions, replacements } = SpdiPascaRepository.#buildConditions(filter);

    const rows = await TbSpdiPasca.findAll({
      attributes: [[literal('kbli'), 'kbli']],
      where: SpdiPascaRepository.#whereLiteral(
        [...conditions, "kbli IS NOT NULL AND TRIM(kbli) <> ''"]
      ),
      replacements,
      raw: true,
    });

    return rows;
  }

  /**
   * Daftar unit berpaginasi dengan filter dan pencarian.
   *
   * `findAndCountAll` dipakai supaya `total` dan isi halaman datang dari
   * predikat yang identik — angka paginasi tidak pernah meleset dari tabel.
   * Kondisi bersama dikirim sebagai `literal` (satu sumber kebenaran untuk
   * dashboard maupun daftar), sedangkan pencarian memakai `Op.like` sesuai
   * spesifikasi.
   *
   * @param {Object} options Opsi query daftar.
   * @param {Object} options.filter Filter `{ kdUpt, kdProvinsi, tahun }`.
   * @param {string|null} [options.search] Kata kunci untuk `nama_unit`/`nomor_sertifikat`.
   * @param {number} options.page Halaman 1-based.
   * @param {number} options.limit Jumlah baris per halaman.
   * @returns {Promise<{rows: Array<Object>, count: number}>}
   */
  static async findPaginatedList({ filter = {}, search = null, page = 1, limit = 10 } = {}) {
    const { conditions, replacements } = SpdiPascaRepository.#buildConditions(filter);
    const where = { [Op.and]: [] };

    const shared = SpdiPascaRepository.#whereLiteral(conditions);
    if (shared) {
      where[Op.and].push(shared);
    }

    if (search) {
      const pattern = SpdiPascaRepository.#likePattern(search);
      where[Op.and].push({
        [Op.or]: [
          { nama_unit: { [Op.like]: pattern } },
          { nomor_sertifikat: { [Op.like]: pattern } },
        ],
      });
    }

    const pageSize = Number(limit) || 10;
    const currentPage = Number(page) || 1;

    const { rows, count } = await TbSpdiPasca.findAndCountAll({
      attributes: [
        'id',
        'nama_unit',
        'tgl_permohonan',
        'tgl_terbit',
        'nomor_sertifikat',
        'kd_upt',
        'nama_upt',
        'kd_provinsi',
        'provinsi',
        'kab_kota',
        'skor_inspeksi',
        'skor_cdib',
        'tagging_kdmp',
        'kbli',
        'produk',
        'status',
        // SLA per baris: NULL bila sertifikat belum terbit.
        [literal('DATEDIFF(tgl_terbit, tgl_permohonan)'), 'sla_hari'],
      ],
      where: where[Op.and].length ? where : undefined,
      order: [[literal('COALESCE(tgl_terbit, tgl_permohonan)'), 'DESC'], ['id', 'DESC']],
      // `limit`/`offset` disisipkan Sequelize sebagai literal numerik (bukan
      // replacement), jadi dinormalkan ke number di sini.
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
      replacements: { ...replacements },
      raw: true,
    });

    return { rows, count: Number(count) || 0 };
  }
}

export default SpdiPascaRepository;
