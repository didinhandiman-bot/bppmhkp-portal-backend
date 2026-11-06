import { literal } from 'sequelize';
import { TbSkpPaska } from '../models/index.js';
import {
  EXPIRING_SOON_DAYS,
  buildSkalaUsahaCase,
  getYearRange,
} from '../utils/skpGrouping.js';

/**
 * Repository Modul SKP (Sertifikasi Kelayakan Pengolahan) - Pasca Panen.
 *
 * Tanggung jawab repository HANYA komunikasi database: menyusun klausa,
 * mengirim replacement, dan mengembalikan baris mentah. Tidak ada rumus bisnis
 * di sini:
 *
 * - Perhitungan YoY, pengisian 12 bulan, dan metadata paginasi milik service.
 * - Ambang `expiring_soon` (EXPIRING_SOON_DAYS) milik util, diteruskan sebagai
 *   replacement `:expiringDays` supaya angka 30 tidak tertulis di dalam SQL.
 * - Normalisasi `skala_usaha` memakai `buildSkalaUsahaCase` dari util, dipakai
 *   sama oleh filter dan GROUP BY agar bucket tidak terpecah.
 *
 * SELURUH pembacaan dieksekusi lewat Model `TbSkpPaska` (Model-First
 * Standard): `findAll` untuk baris/agregasi ber-alias, `count` untuk
 * paginasi. Tidak ada lagi `dbReportSkp.query('... FROM tb_skp_paska')` dengan
 * string nama tabel. Seluruh nilai dari pengguna tetap WAJIB lewat
 * `replacements`; tidak ada interpolasi nilai ke SQL. Literal yang disisipkan
 * hanya nama kolom hasil whitelist (`#buildOrderBy`) dan ekspresi CASE dari
 * util, keduanya bukan input pengguna.
 *
 * Model terikat ke koneksi `report_skp`, jadi SQL tidak di-prefix nama skema.
 * Jangan menambahkan JOIN ke skema `hc` atau `report_siapmutu` (aturan tanpa
 * JOIN lintas koneksi).
 *
 * PERHATIAN Model-First: klausa `WHERE` tidak boleh ikut ditulis di dalam
 * string literal — generator Sequelize menambahkannya sendiri (`mainQueryItems
 * push ' WHERE ' + where`), sehingga menulis `'WHERE ...'` akan menghasilkan
 * `WHERE WHERE ...` dan gagal di MySQL. Lihat `#whereLiteral()`.
 */
class SkpRepository {
  /**
   * Kolom yang boleh dipakai sebagai `ORDER BY`, dipetakan ke nama kolom asli.
   * Dipakai oleh `findTableList`; daftar ini adalah satu-satunya jalan masuk
   * untuk `sortBy` dari query string.
   */
  static #SORTABLE_COLUMNS = new Map([
    ['id', 'id'],
    ['nama_upi', 'nama_upi'],
    ['nib', 'nib'],
    ['provinsi', 'provinsi'],
    ['kota_kabupaten', 'kota_kabupaten'],
    ['skala_usaha', 'skala_usaha'],
    ['jenis_permohonan', 'jenis_permohonan'],
    ['tanggal_pengajuan', 'tanggal_pengajuan'],
    ['tanggal_rekomendasi', 'tanggal_rekomendasi'],
    ['tanggal_terbit', 'tanggal_terbit'],
    ['tanggal_kadaluarsa', 'tanggal_kadaluarsa'],
    ['nomor_skp', 'nomor_skp'],
    ['jenis_olahan', 'jenis_olahan'],
    ['peringkat', 'peringkat'],
  ]);

  /**
   * Menyusun daftar kondisi WHERE bersama untuk summary, tren, dan distribusi.
   *
   * Fungsi ini sengaja mengembalikan ARRAY kondisi, bukan fragmen `WHERE ...`,
   * karena pemanggil butuh menempelkan kondisi tambahan (pencarian, status)
   * dan karena `findSummaryMetrics` memerlukan rentang dua tahun sekaligus.
   * Gunakan `SkpRepository.#whereLiteral()` untuk merakitnya menjadi literal
   * siap pakai pada opsi `where` Model.
   *
   * Rentang tanggal memakai bentuk `>= :rangeStart AND < :rangeEnd` (bukan
   * `YEAR(tanggal_terbit) = :year`) supaya tidak membungkus kolom dan tetap
   * sargable. Filter `skala_usaha` memakai ekspresi CASE yang sama dengan
   * `GROUP BY`; kalau filter memakai nilai mentah, "Mikro" tidak akan menangkap
   * baris "Usaha Mikro".
   *
   * @param {Object} filter Filter yang sudah dibersihkan.
   * @param {Object} range Rentang `{ start, endNext }` yang akan difilter.
   * @param {string} [alias] Awalan kolom, misal `''` atau `'s.'`.
   * @returns {{conditions: string[], replacements: Object}} Kondisi dan parameter.
   */
  static #buildConditions(filter, range, alias = '') {
    const conditions = [
      `${alias}tanggal_terbit >= :rangeStart`,
      `${alias}tanggal_terbit < :rangeEnd`,
    ];
    const replacements = { rangeStart: range.start, rangeEnd: range.endNext };

    if (filter.kdUnit) {
      conditions.push(`${alias}kd_unit = :kdUnit`);
      replacements.kdUnit = filter.kdUnit;
    }

    if (filter.provinsiId) {
      conditions.push(`${alias}provinsi_id = :provinsiId`);
      replacements.provinsiId = filter.provinsiId;
    }

    if (filter.skalaUsaha) {
      conditions.push(`${buildSkalaUsahaCase(`${alias}skala_usaha`)} = :skalaUsaha`);
      replacements.skalaUsaha = filter.skalaUsaha;
    }

    if (filter.peringkat) {
      conditions.push(`UPPER(TRIM(${alias}peringkat)) = :peringkat`);
      replacements.peringkat = filter.peringkat;
    }

    return { conditions, replacements };
  }

  /**
   * Merakit daftar kondisi menjadi literal `WHERE` untuk opsi `where` Model.
   *
   * Sengaja TANPA kata kunci `WHERE`: generator Sequelize menambahkannya
   * sendiri, sehingga menyertakannya akan menghasilkan `WHERE WHERE ...`.
   * Seluruh nilai pengguna sudah berada di `replacements` yang dikirim
   * bersamaan dengan `findAll`/`count`.
   *
   * @param {string[]} conditions Kondisi hasil `#buildConditions`.
   * @returns {import('sequelize').Literal} Literal kondisi yang di-AND-kan.
   */
  static #whereLiteral(conditions) {
    return literal(conditions.join(' AND '));
  }

  /**
   * Ringkasan metrik untuk satu tahun beserta pembanding tahun sebelumnya.
   *
   * KEDUA tahun dihitung dalam SATU pass tabel. Rentang `WHERE` sengaja
   * mencakup dua tahun (tahun sebelumnya sampai tahun berjalan), lalu
   * masing-masing angka dihitung dengan `CASE` bersyarat. Bila `WHERE` dibatasi
   * hanya ke tahun berjalan, `CASE` tahun sebelumnya tidak akan pernah cocok
   * dan `yoyGrowth` selalu nol.
   *
   * `totalAktif`, `totalExpired`, dan `totalUpi` sengaja ikut dijaga agar hanya
   * menghitung baris tahun berjalan, supaya angkanya konsisten dengan
   * `totalTerbit` yang ditampilkan di sebelahnya.
   *
   * Memakai `findAll` dengan atribut `[literal(...), alias]` (bukan
   * `Model.count`) karena kelimanya harus dihitung dalam SATU pass tabel —
   * `count` hanya menghasilkan satu angka.
   *
   * @param {Object} filter Filter `{ year, provinsiId, skalaUsaha, peringkat }`.
   * @returns {Promise<Object>} Agregasi mentah (masih string dari MySQL).
   */
  static async findSummaryMetrics(filter) {
    const year = Number(filter.year);
    const currentRange = getYearRange(year);
    const prevRange = getYearRange(year - 1);

    // `WHERE` mencakup dua tahun, sedangkan `CASE` tahun berjalan memakai
    // sepasang parameter sendiri (`:currentStart`/`:currentEnd`). Bila keduanya
    // memakai nama parameter yang sama, `CASE` ikut melebar ke dua tahun dan
    // `totalTerbit` mengembalikan seluruh baris dua tahun.
    const { conditions, replacements } = SkpRepository.#buildConditions(filter, {
      start: prevRange.start,
      endNext: currentRange.endNext,
    });

    const inCurrentYear = 'tanggal_terbit >= :currentStart AND tanggal_terbit < :currentEnd';
    const inPrevYear = 'tanggal_terbit >= :prevStart AND tanggal_terbit < :prevEnd';

    const rows = await TbSkpPaska.findAll({
      attributes: [
        [literal(`COUNT(CASE WHEN ${inCurrentYear} THEN 1 END)`), 'totalTerbit'],
        [literal(`COUNT(CASE WHEN ${inPrevYear} THEN 1 END)`), 'totalTerbitPrevYear'],
        [literal(`COUNT(CASE
          WHEN ${inCurrentYear}
            AND tanggal_kadaluarsa IS NOT NULL
            AND tanggal_kadaluarsa >= CURRENT_DATE()
          THEN 1
        END)`), 'totalAktif'],
        [literal(`COUNT(CASE
          WHEN ${inCurrentYear}
            AND tanggal_kadaluarsa IS NOT NULL
            AND tanggal_kadaluarsa < CURRENT_DATE()
          THEN 1
        END)`), 'totalExpired'],
        [literal(`COUNT(DISTINCT CASE
          WHEN ${inCurrentYear}
          THEN COALESCE(NULLIF(TRIM(nib), ''), NULLIF(TRIM(nama_upi), ''))
        END)`), 'totalUpi'],
      ],
      where: SkpRepository.#whereLiteral(conditions),
      replacements: {
        ...replacements,
        currentStart: currentRange.start,
        currentEnd: currentRange.endNext,
        prevStart: prevRange.start,
        prevEnd: prevRange.endNext,
      },
      // Tanpa `raw`, alias yang bukan atribut model (`totalTerbit`, ...) hilang
      // karena Sequelize membangun instance Model dari hasil.
      raw: true,
    });

    const [row] = rows;
    return row;
  }

  /**
   * Deret waktu 12 bulan untuk tahun berjalan dan tahun sebelumnya.
   *
   * SQL hanya mengembalikan bulan yang memang punya baris; pengisian 12 slot
   * (termasuk bulan kosong bernilai 0) dilakukan di service agar logika
   * perataan tidak tercecer di lapisan SQL.
   *
   * @param {Object} filter Filter `{ year, provinsiId }`.
   * @returns {Promise<Array<{tahun: number, bulan: number, total: number}>>}
   */
  static async findMonthlyTrends(filter) {
    // Rentang mencakup tahun sebelumnya DAN tahun berjalan, karena service
    // mengisi dua kolom (`currentYear` dan `previousYear`) dari satu query.
    const currentRange = getYearRange(Number(filter.year));
    const prevRange = getYearRange(Number(filter.year) - 1);

    const { conditions, replacements } = SkpRepository.#buildConditions(filter, {
      start: prevRange.start,
      endNext: currentRange.endNext,
    });

    const rows = await TbSkpPaska.findAll({
      attributes: [
        [literal('YEAR(tanggal_terbit)'), 'tahun'],
        [literal('MONTH(tanggal_terbit)'), 'bulan'],
        [literal('COUNT(id)'), 'total'],
      ],
      where: SkpRepository.#whereLiteral(conditions),
      group: [literal('YEAR(tanggal_terbit)'), literal('MONTH(tanggal_terbit)')],
      order: [[literal('tahun'), 'ASC'], [literal('bulan'), 'ASC']],
      replacements,
      raw: true,
    });

    return rows;
  }

  /**
   * Distribusi SKP: peringkat, skala usaha, jenis pengolahan, dan wilayah.
   *
   * Keempat agregasi dijalankan bersamaan lewat `Promise.all` karena saling
   * bebas; wall-clock-nya jadi satu pemindaian tabel, bukan empat.
   *
   * @param {Object} filter Filter `{ year, provinsiId }`.
   * @returns {Promise<{byPeringkat: Array, bySkalaUsaha: Array, topJenisOlahan: Array, topWilayah: Array}>}
   */
  static async findDistribution(filter) {
    const { conditions, replacements } = SkpRepository.#buildConditions(
      filter,
      getYearRange(Number(filter.year)),
    );
    const skalaCase = buildSkalaUsahaCase('skala_usaha');

    // Literal WHERE dibuat terpisah per query: keempat `findAll` berjalan
    // bersamaan, dan satu objek literal jangan dibagikan antar permintaan.
    const byPeringkatQuery = TbSkpPaska.findAll({
      attributes: [
        [literal(`NULLIF(UPPER(TRIM(peringkat)), '')`), 'label'],
        [literal('COUNT(id)'), 'total'],
      ],
      where: SkpRepository.#whereLiteral(conditions),
      group: [literal(`NULLIF(UPPER(TRIM(peringkat)), '')`)],
      order: [[literal('total'), 'DESC'], [literal('label'), 'ASC']],
      replacements: { ...replacements },
      raw: true,
    });

    // `Lainnya` menggabungkan placeholder yang tidak bisa dipetakan ke empat
    // bucket (mis. nilai "-"), sehingga total bucket selalu sama dengan
    // `totalTerbit` pada summary.
    const bySkalaUsahaQuery = TbSkpPaska.findAll({
      attributes: [[literal(skalaCase), 'label'], [literal('COUNT(id)'), 'total']],
      where: SkpRepository.#whereLiteral(conditions),
      group: [literal(skalaCase)],
      order: [[literal('total'), 'DESC'], [literal('label'), 'ASC']],
      replacements: { ...replacements },
      raw: true,
    });

    const topJenisOlahanQuery = TbSkpPaska.findAll({
      attributes: [
        [literal(`NULLIF(TRIM(jenis_olahan), '')`), 'label'],
        [literal('COUNT(id)'), 'total'],
      ],
      // Kondisi ekstra digabung ke literal yang sama; tidak perlu `WHERE`
      // tambahan karena generator Sequelize hanya menambahkannya sekali.
      where: literal(
        `${conditions.join(' AND ')} AND NULLIF(TRIM(jenis_olahan), '') IS NOT NULL`,
      ),
      group: [literal(`NULLIF(TRIM(jenis_olahan), '')`)],
      order: [[literal('total'), 'DESC'], [literal('label'), 'ASC']],
      limit: 10,
      replacements: { ...replacements },
      raw: true,
    });

    const topWilayahQuery = TbSkpPaska.findAll({
      attributes: [
        [literal(`NULLIF(TRIM(provinsi), '')`), 'label'],
        [literal('COUNT(id)'), 'total'],
      ],
      where: SkpRepository.#whereLiteral(conditions),
      group: [literal(`NULLIF(TRIM(provinsi), '')`)],
      order: [[literal('total'), 'DESC'], [literal('label'), 'ASC']],
      limit: 10,
      replacements: { ...replacements },
      raw: true,
    });

    const [byPeringkat, bySkalaUsaha, topJenisOlahan, topWilayah] = await Promise.all([
      byPeringkatQuery,
      bySkalaUsahaQuery,
      topJenisOlahanQuery,
      topWilayahQuery,
    ]);

    return { byPeringkat, bySkalaUsaha, topJenisOlahan, topWilayah };
  }

  /**
   * Menghitung jumlah baris untuk paginasi.
   *
   * Dipisah dari query data supaya `LIMIT` tidak memotong hasil `COUNT`.
   * Memakai `TbSkpPaska.count` karena hanya satu angka yang dibutuhkan;
   * klausa `WHERE`-nya literal sehingga seluruh nilai tetap dari `replacements`.
   *
   * @param {Object} filter Filter yang sudah lengkap termasuk `search` dan `status`.
   * @returns {Promise<number>} Jumlah baris yang cocok.
   */
  static async countTableList(filter) {
    const { conditions, replacements } = SkpRepository.#buildConditions(
      filter,
      getYearRange(Number(filter.year)),
    );
    const { conditions: extra, replacements: extraReplacements } =
      SkpRepository.#buildOptionalConditions(filter);

    const total = await TbSkpPaska.count({
      where: SkpRepository.#whereLiteral([...conditions, ...extra]),
      replacements: { ...replacements, ...extraReplacements },
    });

    return Number(total) || 0;
  }

  /**
   * Mengambil satu halaman data SKP.
   *
   * @param {Object} filter Filter lengkap `{ year, provinsiId, skalaUsaha, peringkat, search, status, limit, offset, sortBy, sortOrder }`.
   * @returns {Promise<Array<Object>>} Baris SKP untuk halaman tersebut.
   */
  static async findTableList(filter) {
    const { conditions, replacements } = SkpRepository.#buildConditions(
      filter,
      getYearRange(Number(filter.year)),
    );
    const { conditions: extra, replacements: extraReplacements } =
      SkpRepository.#buildOptionalConditions(filter);
    const orderBy = SkpRepository.#buildOrderBy(filter);

    const rows = await TbSkpPaska.findAll({
      attributes: [
        'id',
        'nama_upi',
        'nib',
        'provinsi_id',
        'provinsi',
        'regency_id',
        'kota_kabupaten',
        'alamat',
        'skala_usaha',
        'jenis_permohonan',
        'tanggal_pengajuan',
        'tanggal_rekomendasi',
        'tanggal_terbit',
        'tanggal_kadaluarsa',
        'nomor_skp',
        'nama_produk',
        'jenis_olahan',
        'peringkat',
        [literal(SkpRepository.#buildStatusCase()), 'status_skp'],
      ],
      where: SkpRepository.#whereLiteral([...conditions, ...extra]),
      order: [literal(orderBy)],
      // `limit`/`offset` harus number; Sequelize menyisipkannya sebagai literal
      // numerik (bukan replacement), jadi keduanya dinormalkan dulu di sini.
      limit: Number(filter.limit) || 10,
      offset: Number(filter.offset) || 0,
      replacements: {
        ...replacements,
        ...extraReplacements,
        // Selalu dikirim, bukan hanya saat `status=expiring_soon`, karena
        // ekspresi status kolom selalu memakainya.
        expiringDays: EXPIRING_SOON_DAYS,
      },
      // Tanpa `raw`, `status_skp` (alias hasil literal, bukan atribut model)
      // hilang dari hasil dan kolom DATE kembali sebagai instance Date.
      raw: true,
    });

    return rows;
  }

  /**
   * Ekspresi SQL untuk status SKP, dipakai sebagai kolom bantu di tabel.
   *
   * Ambang `expiring_soon` diambil dari replacement `:expiringDays` (nilai
   * EXPIRING_SOON_DAYS milik util) supaya angka yang sama dipakai oleh filter
   * tabel dan badge di baris, dan angka itu sendiri tidak tertulis di SQL.
   *
   * @returns {string} Ekspresi SQL CASE.
   */
  static #buildStatusCase() {
    return `CASE
      WHEN tanggal_kadaluarsa IS NULL THEN NULL
      WHEN tanggal_kadaluarsa < CURRENT_DATE() THEN 'expired'
      WHEN tanggal_kadaluarsa <= DATE_ADD(CURRENT_DATE(), INTERVAL :expiringDays DAY) THEN 'expiring_soon'
      ELSE 'aktif'
    END`;
  }

  /**
   * Klausa tambahan untuk pencarian bebas dan filter status.
   *
   * `search` di-escape lebih dulu: nilai mentah bisa mengandung `%` atau `_`,
   * yang pada `LIKE` berarti wildcard. Tanpa `ESCAPE`, pencarian "100%" akan
   * mencocokkan semua baris.
   *
   * @param {Object} filter Filter yang mungkin berisi `search` dan `status`.
   * @returns {{conditions: string[], replacements: Object}}
   */
  static #buildOptionalConditions(filter) {
    const conditions = [];
    const replacements = {};

    if (filter.search) {
      // Escape wildcard LIKE agar pencarian "100%" tidak berubah menjadi
      // "cocok semua". `\` harus di-escape dua kali agar SQL melihat satu
      // karakter backslash sebagai penanda ESCAPE.
      const escaped = String(filter.search).replace(/[\\%_]/g, (ch) => `\\${ch}`);

      conditions.push(`(
        nama_upi LIKE :search ESCAPE '\\\\'
        OR nib LIKE :search ESCAPE '\\\\'
        OR nomor_skp LIKE :search ESCAPE '\\\\'
        OR nama_produk LIKE :search ESCAPE '\\\\'
      )`);
      replacements.search = `%${escaped}%`;
    }

    if (filter.status === 'aktif') {
      conditions.push(`(
        tanggal_kadaluarsa IS NOT NULL AND tanggal_kadaluarsa >= CURRENT_DATE()
      )`);
    } else if (filter.status === 'expired') {
      conditions.push(`(
        tanggal_kadaluarsa IS NOT NULL AND tanggal_kadaluarsa < CURRENT_DATE()
      )`);
    } else if (filter.status === 'expiring_soon') {
      conditions.push(`(
        tanggal_kadaluarsa IS NOT NULL
        AND tanggal_kadaluarsa >= CURRENT_DATE()
        AND tanggal_kadaluarsa <= DATE_ADD(CURRENT_DATE(), INTERVAL :expiringDays DAY)
      )`);
      replacements.expiringDays = EXPIRING_SOON_DAYS;
    }

    return { conditions, replacements };
  }

  /**
   * Menyusun `ORDER BY` dari input pengguna.
   *
   * `sortBy` dan `sortOrder` masuk ke SQL sebagai literal, jadi keduanya harus
   * melewati whitelist. Nilai di luar daftar jatuh ke default, bukan error 500.
   *
   * @param {Object} filter Filter berisi `sortBy` dan `sortOrder`.
   * @returns {string} Fragmen `ORDER BY`.
   */
  static #buildOrderBy(filter) {
    const column = SkpRepository.#SORTABLE_COLUMNS.get(filter.sortBy) || 'tanggal_terbit';
    const direction = String(filter.sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    return `${column} ${direction}, id DESC`;
  }
}

export default SkpRepository;
