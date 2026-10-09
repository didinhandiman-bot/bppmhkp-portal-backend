import { QueryTypes } from 'sequelize';
import { dbReportSkp } from '../config/database.js';
import {
  EXPIRING_SOON_DAYS,
  buildSkalaUsahaCase,
  getYearRange,
} from '../utils/skpGrouping.js';

/**
 * Repository Modul SKP (Sertifikasi Kelayakan Pengolahan) - Pasca Panen.
 *
 * Tanggung jawab repository HANYA komunikasi database: menyusun SQL,
 * mengirim replacement, dan mengembalikan baris mentah. Tidak ada rumus bisnis
 * di sini:
 *
 * - Perhitungan YoY, pengisian 12 bulan, dan metadata paginasi milik service.
 * - Ambang `expiring_soon` (EXPIRING_SOON_DAYS) milik util, diteruskan sebagai
 *   replacement `:expiringDays` supaya angka 30 tidak tertulis di dalam SQL.
 * - Normalisasi `skala_usaha` memakai `buildSkalaUsahaCase` dari util, dipakai
 *   sama oleh filter dan GROUP BY agar bucket tidak terpecah.
 *
 * Seluruh query memakai raw SQL + `replacements`, bukan model Sequelize, untuk
 * menjaga konsistensi dengan `smkhpRepository.js` di repo ini. Setiap nilai dari
 * pengguna WAJIB lewat `replacements`; tidak ada interpolasi string ke SQL.
 * Satu-satunya literal yang disisipkan adalah nama kolom hasil whitelist
 * (`#buildOrderBy`) dan ekspresi CASE dari util, keduanya bukan input pengguna.
 *
 * SQL tidak di-prefix nama skema karena `dbReportSkp` sudah terhubung langsung ke
 * `report_skp`. Jangan menambahkan JOIN ke skema `hc` atau `report_siapmutu`.
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
   * Gunakan `SkpRepository.#toWhereClause()` untuk merakitnya.
   *
   * Rentang tanggal memakai bentuk `>= :start AND < :endNext` (bukan
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
   * Merakit daftar kondisi menjadi klausa `WHERE`.
   *
   * @param {string[]} conditions Kondisi hasil `#buildConditions`.
   * @returns {string} Fragmen `WHERE ...`.
   */
  static #toWhereClause(conditions) {
    return `WHERE ${conditions.join(' AND ')}`;
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

    const query = `
      SELECT
        COUNT(CASE WHEN ${inCurrentYear} THEN 1 END) AS totalTerbit,
        COUNT(CASE WHEN ${inPrevYear} THEN 1 END) AS totalTerbitPrevYear,
        COUNT(CASE
          WHEN ${inCurrentYear}
            AND tanggal_kadaluarsa IS NOT NULL
            AND tanggal_kadaluarsa >= CURRENT_DATE()
          THEN 1
        END) AS totalAktif,
        COUNT(CASE
          WHEN ${inCurrentYear}
            AND tanggal_kadaluarsa IS NOT NULL
            AND tanggal_kadaluarsa < CURRENT_DATE()
          THEN 1
        END) AS totalExpired,
        COUNT(DISTINCT CASE
          WHEN ${inCurrentYear}
          THEN COALESCE(NULLIF(TRIM(nib), ''), NULLIF(TRIM(nama_upi), ''))
        END) AS totalUpi
      FROM tb_skp_paska
      ${SkpRepository.#toWhereClause(conditions)}
    `;

    const [row] = await dbReportSkp.query(query, {
      replacements: {
        ...replacements,
        currentStart: currentRange.start,
        currentEnd: currentRange.endNext,
        prevStart: prevRange.start,
        prevEnd: prevRange.endNext,
      },
      type: QueryTypes.SELECT,
    });

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

    const query = `
      SELECT
        YEAR(tanggal_terbit) AS tahun,
        MONTH(tanggal_terbit) AS bulan,
        COUNT(id) AS total
      FROM tb_skp_paska
      ${SkpRepository.#toWhereClause(conditions)}
      GROUP BY YEAR(tanggal_terbit), MONTH(tanggal_terbit)
      ORDER BY tahun ASC, bulan ASC
    `;

    const rows = await dbReportSkp.query(query, {
      replacements,
      type: QueryTypes.SELECT,
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
    const where = SkpRepository.#toWhereClause(conditions);
    const skalaCase = buildSkalaUsahaCase('skala_usaha');

    const byPeringkatQuery = `
      SELECT
        NULLIF(UPPER(TRIM(peringkat)), '') AS label,
        COUNT(id) AS total
      FROM tb_skp_paska
      ${where}
      GROUP BY NULLIF(UPPER(TRIM(peringkat)), '')
      ORDER BY total DESC, label ASC
    `;

    // `Lainnya` menggabungkan placeholder yang tidak bisa dipetakan ke empat
    // bucket (mis. nilai "-"), sehingga total bucket selalu sama dengan
    // `totalTerbit` pada summary.
    const bySkalaUsahaQuery = `
      SELECT
        ${skalaCase} AS label,
        COUNT(id) AS total
      FROM tb_skp_paska
      ${where}
      GROUP BY ${skalaCase}
      ORDER BY total DESC, label ASC
    `;

    const topJenisOlahanQuery = `
      SELECT
        NULLIF(TRIM(jenis_olahan), '') AS label,
        COUNT(id) AS total
      FROM tb_skp_paska
      ${where}
      AND NULLIF(TRIM(jenis_olahan), '') IS NOT NULL
      GROUP BY NULLIF(TRIM(jenis_olahan), '')
      ORDER BY total DESC, label ASC
      LIMIT 10
    `;

    const topWilayahQuery = `
      SELECT
        NULLIF(TRIM(provinsi), '') AS label,
        COUNT(id) AS total
      FROM tb_skp_paska
      ${where}
      GROUP BY NULLIF(TRIM(provinsi), '')
      ORDER BY total DESC, label ASC
      LIMIT 10
    `;

    const [byPeringkat, bySkalaUsaha, topJenisOlahan, topWilayah] = await Promise.all([
      dbReportSkp.query(byPeringkatQuery, { replacements, type: QueryTypes.SELECT }),
      dbReportSkp.query(bySkalaUsahaQuery, { replacements, type: QueryTypes.SELECT }),
      dbReportSkp.query(topJenisOlahanQuery, { replacements, type: QueryTypes.SELECT }),
      dbReportSkp.query(topWilayahQuery, { replacements, type: QueryTypes.SELECT }),
    ]);

    return { byPeringkat, bySkalaUsaha, topJenisOlahan, topWilayah };
  }

  /**
   * Menghitung jumlah baris untuk paginasi.
   *
   * Dipisah dari query data supaya `LIMIT` tidak memotong hasil `COUNT`.
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

    const query = `
      SELECT COUNT(id) AS totalRows
      FROM tb_skp_paska
      ${SkpRepository.#toWhereClause([...conditions, ...extra])}
    `;

    const [row] = await dbReportSkp.query(query, {
      replacements: { ...replacements, ...extraReplacements },
      type: QueryTypes.SELECT,
    });

    return Number(row?.totalRows) || 0;
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

    const query = `
      SELECT
        id,
        nama_upi,
        nib,
        provinsi_id,
        provinsi,
        regency_id,
        kota_kabupaten,
        alamat,
        skala_usaha,
        jenis_permohonan,
        tanggal_pengajuan,
        tanggal_rekomendasi,
        tanggal_terbit,
        tanggal_kadaluarsa,
        nomor_skp,
        nama_produk,
        jenis_olahan,
        peringkat,
        ${SkpRepository.#buildStatusCase()} AS status_skp
      FROM tb_skp_paska
      ${SkpRepository.#toWhereClause([...conditions, ...extra])}
      ORDER BY ${orderBy}
      LIMIT :limit OFFSET :offset
    `;

    const rows = await dbReportSkp.query(query, {
      replacements: {
        ...replacements,
        ...extraReplacements,
        // Selalu dikirim, bukan hanya saat `status=expiring_soon`, karena
        // ekspresi status kolom selalu memakainya.
        expiringDays: EXPIRING_SOON_DAYS,
        limit: Number(filter.limit) || 10,
        offset: Number(filter.offset) || 0,
      },
      type: QueryTypes.SELECT,
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
   * mencocokikan semua baris.
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
