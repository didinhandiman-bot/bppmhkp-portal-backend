import { literal } from 'sequelize';
import { Vw07Sertifikasi } from '../models/index.js';

/**
 * Repository Modul HACCP (Sertifikasi V07) - Pasca Panen.
 *
 * SELURUH pembacaan dieksekusi lewat Model `Vw07Sertifikasi` (Model-First
 * Standard): `findAll` dengan atribut agregasi `[literal(...), alias]` untuk
 * KPI/charts, dan `findAll` + `count` untuk tabel berpaginasi. Tidak ada lagi
 * `dbHaccp.query('... FROM report_haccp.vw07_sertifikasi')` dengan string nama
 * tabel maupun instance koneksi mentah.
 *
 * Model terikat ke koneksi `report_haccp` di `src/models/index.js`, jadi SQL
 * tidak di-prefix nama skema. Jangan menambahkan JOIN ke skema lain (aturan
 * tanpa JOIN lintas koneksi).
 *
 * PERHATIAN Model-First: klausa `WHERE` tidak boleh ikut ditulis di dalam
 * string literal — generator Sequelize menambahkannya sendiri (`mainQueryItems
 * push ' WHERE ' + where`), sehingga menulis `'WHERE ...'` akan menghasilkan
 * `WHERE WHERE ...` dan gagal di MySQL. `#buildWhere` mengembalikan ARRAY
 * kondisi yang dirakit menjadi `literal(conditions.join(' AND '))`, atau
 * `undefined` bila tidak ada filter sama sekali.
 *
 * Seluruh nilai dari pengguna WAJIB lewat `replacements`; tidak ada interpolasi
 * nilai ke SQL. `raw: true` dipakai agar alias hasil agregasi (`total`,
 * `bulan`, ...) tidak hilang dibangun sebagai instance Model, dan struktur
 * payload JSON identik dengan implementasi raw-query sebelumnya.
 */

/**
 * Escape karakter wildcard LIKE (`%`, `_`) dan backslash agar pencarian bebas
 * tidak berubah menjadi "cocok semua". Perilaku identik dengan versi raw query.
 *
 * @param {string} value Nilai mentah dari query string.
 * @returns {string} Nilai yang sudah di-escape.
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Menyusun daftar kondisi WHERE bersama untuk KPI, charts, dan tabel.
 *
 * Mengembalikan array kondisi (tanpa kata kunci `WHERE`) plus objek
 * `replacements` yang diisi in-place. Filter UPT HACCP memakai tiga nama
 * (`upt` / `kdUnit` / `idUpt`): user terbatas hanya mencocokkan `kd_unit`,
 * sisanya boleh mencocokkan `kd_unit` atau `id_upt`. Rentang tanggal memakai
 * `BETWEEN` dengan batas akhir dilebarkan ke `23:59:59` (kolom `tgl_terbit`
 * bertipe DATE, pelebaran tidak berbahaya).
 *
 * @param {Object} filters Filter `{ startDate, endDate, idUpt, upt, kdUnit, grade, statusSert, _uptRestricted }`.
 * @param {Object} replacements Objek target replacement (diisi in-place).
 * @returns {string[]} Array kondisi, kosong bila tidak ada filter.
 */
function buildConditions(filters, replacements) {
  const { startDate, endDate, idUpt, upt, kdUnit, grade, statusSert, _uptRestricted } = filters;
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
    w.push(_uptRestricted ? 'kd_unit = :upt' : '(kd_unit = :upt OR id_upt = :upt)');
    replacements.upt = uptVal;
  }
  if (grade) {
    w.push('grade = :grade');
    replacements.grade = grade;
  }
  if (statusSert) {
    w.push('status_sert = :statusSert');
    replacements.statusSert = statusSert;
  }
  return w;
}

/**
 * Merakit daftar kondisi menjadi opsi `where` + `replacements` untuk Model.
 *
 * @param {string[]} conditions Kondisi hasil `buildConditions`.
 * @param {Object} replacements Replacement yang sudah lengkap.
 * @returns {Object} Opsi tambahan untuk `findAll`/`count`.
 */
function whereOptions(conditions, replacements) {
  return conditions.length
    ? { where: literal(conditions.join(' AND ')), replacements }
    : { replacements };
}

class HaccpRepository {
  static async getKpi(filters = {}) {
    const r = {};
    const conditions = buildConditions(filters, r);

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal('COUNT(*)'), 'totalSertifikat'],
        [literal("SUM(CASE WHEN status_sert = 'BERLAKU' THEN 1 ELSE 0 END)"), 'totalBerlaku'],
        [literal("SUM(CASE WHEN status_sert = 'KADALUARSA' THEN 1 ELSE 0 END)"), 'totalKadaluarsa'],
        [literal('COUNT(DISTINCT id_upi)'), 'totalUpi'],
        [literal('AVG(CASE WHEN tgl_terima IS NOT NULL AND tgl_terbit IS NOT NULL THEN DATEDIFF(tgl_terbit, tgl_terima) ELSE NULL END)'), 'avgProsesHari'],
      ],
      ...whereOptions(conditions, r),
      raw: true,
    });

    const row = rows[0] ?? {};
    return {
      totalSertifikat: Number(row.totalSertifikat ?? 0),
      totalBerlaku: Number(row.totalBerlaku ?? 0),
      totalKadaluarsa: Number(row.totalKadaluarsa ?? 0),
      totalUpi: Number(row.totalUpi ?? 0),
      avgProsesHari: row.avgProsesHari === null || row.avgProsesHari === undefined ? null : Number(row.avgProsesHari),
    };
  }

  static async getGradeDistribution(filters = {}) {
    const r = {};
    const conditions = buildConditions(filters, r);
    const gradeExpr = "COALESCE(NULLIF(TRIM(grade), ''), 'Tidak Ada')";

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal(gradeExpr), 'grade'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...whereOptions(conditions, r),
      group: [literal(gradeExpr)],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });

    return rows.map(x => ({ grade: x.grade, total: Number(x.total) }));
  }

  static async getStatusProduk(filters = {}) {
    const r = {};
    const conditions = buildConditions(filters, r);
    const statusExpr = "COALESCE(NULLIF(TRIM(status_produk), ''), 'Tidak Ada')";

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal(statusExpr), 'status_produk'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...whereOptions(conditions, r),
      group: [literal(statusExpr)],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });

    return rows.map(x => ({ status_produk: x.status_produk, total: Number(x.total) }));
  }

  static async getKategoriProduk(filters = {}) {
    const r = {};
    const conditions = buildConditions(filters, r);
    const kategoriExpr = "COALESCE(NULLIF(TRIM(nama_kategori), ''), 'Tidak Ada')";

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal(kategoriExpr), 'nama_kategori'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...whereOptions(conditions, r),
      group: [literal(kategoriExpr)],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });

    return rows.map(x => ({ nama_kategori: x.nama_kategori, total: Number(x.total) }));
  }

  static async getTopProduk(filters = {}, limit = 10) {
    const r = {};
    const conditions = buildConditions(filters, r);
    const produkExpr = "COALESCE(NULLIF(TRIM(nama_produk), ''), 'Tidak Ada')";

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal(produkExpr), 'nama_produk'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...whereOptions(conditions, r),
      group: [literal(produkExpr)],
      order: [[literal('total'), 'DESC']],
      // `limit` harus number; Sequelize menyisipkannya sebagai literal numerik.
      limit: Number(limit) || 10,
      raw: true,
    });

    return rows.map(x => ({ nama_produk: x.nama_produk, total: Number(x.total) }));
  }

  static async getTopUpt(filters = {}, limit = 10) {
    const r = {};
    const conditions = buildConditions(filters, r);
    const uptExpr = "COALESCE(NULLIF(TRIM(upt), ''), 'Tidak Ada')";

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal(uptExpr), 'upt'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...whereOptions(conditions, r),
      group: [literal(uptExpr)],
      order: [[literal('total'), 'DESC']],
      limit: Number(limit) || 10,
      raw: true,
    });

    return rows.map(x => ({ upt: x.upt, total: Number(x.total) }));
  }

  static async getMonthlyTrend(filters = {}) {
    const r = {};
    const conditions = buildConditions(filters, r);
    const bulanExpr = "DATE_FORMAT(tgl_terbit, '%Y-%m')";

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal(bulanExpr), 'bulan'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...whereOptions(conditions, r),
      group: [literal(bulanExpr)],
      order: [[literal('bulan'), 'ASC']],
      raw: true,
    });

    return rows.map(x => ({ bulan: x.bulan, total: Number(x.total) }));
  }

  static async getInvestmentDistribution(filters = {}) {
    const r = {};
    const conditions = buildConditions(filters, r);
    const skalaExpr = "COALESCE(NULLIF(TRIM(skala), ''), 'Tidak Ada')";

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal(skalaExpr), 'investment'],
        [literal('COUNT(*)'), 'total'],
      ],
      ...whereOptions(conditions, r),
      group: [literal(skalaExpr)],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });

    return rows.map(x => ({ investment: x.investment, total: Number(x.total) }));
  }

  static async getTable(filters = {}, pagination = {}) {
    const r = {};
    const conditions = buildConditions(filters, r);

    if (filters.search) {
      conditions.push(
        '(upi_name LIKE :search OR nama_produk LIKE :search OR nama_kategori LIKE :search OR no_haccp LIKE :search OR upt LIKE :search)',
      );
      r.search = `%${escapeLike(filters.search)}%`;
    }

    const page = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(pagination.limit) || 10));
    const offset = (page - 1) * limit;

    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        'no_haccp',
        'upi_name',
        'nama_produk',
        'nama_kategori',
        'grade',
        'upt',
        'tgl_terbit',
        'tgl_akhir',
        'status_sert',
      ],
      ...whereOptions(conditions, r),
      order: [['tgl_terbit', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const count = await Vw07Sertifikasi.count({
      ...whereOptions(conditions, { ...r }),
    });

    return { rows, count: Number(count ?? 0), page, limit };
  }
}

export default HaccpRepository;
