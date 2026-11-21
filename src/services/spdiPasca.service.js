import SpdiPascaRepository from '../repositories/spdiPasca.repository.js';
import { normalizeProvinceCode, provinceNameFromCode } from '../utils/provinceCode.js';
import { normalizeUptCode, sanitizeLabel } from '../utils/uptCode.js';

/**
 * Service Modul SPDI Pascapanen.
 *
 * Tugas service: membersihkan query string menjadi filter bertipe benar,
 * menjalankan repository secara paralel, dan merapikan hasil agregasi MySQL
 * (angka yang kembali sebagai string dijadikan number, string `kbli` koma
 * dipecah menjadi frekuensi untuk Donut Chart, label dibersihkan).
 *
 * Mengikuti bentuk modul lain di repo ini: kelas dengan method `static`,
 * diekspor sebagai kelas dan dipanggil `SpdiPascaService.xxx()`. Tidak ada
 * SQL di layer ini.
 */
class SpdiPascaService {
  /**
   * Batas `limit` paginasi. Tanpa batas atas, `?limit=100000` akan menarik
   * seluruh tabel ke memori.
   */
  static #MAX_LIMIT = 100;

  /**
   * Jumlah slice KBLI teratas yang ditampilkan sendiri pada Donut Chart.
   * Sisanya digabung ke bucket `Lainnya` agar chart tidak pecah menjadi puluhan
   * irisan tipis.
   */
  static #KBLI_TOP_N = 8;

  /**
   * Membersihkan dan memvalidasi query string menjadi objek filter.
   *
   * Seluruh nilai `req.query` adalah string; dinormalkan di sini supaya
   * repository menerima tipe yang benar. Nilai di luar format yang sah dibuang,
   * bukan diteruskan ke SQL.
   *
   * @param {Object} query `req.query`.
   * @param {Object} [opts] Opsi tambahan `{ withPage }` untuk menyertakan paginasi.
   * @returns {Object} Filter tervalidasi `{ kdUpt, kdProvinsi, tahun }`.
   */
  static #parseFilters(query = {}, opts = {}) {
    const withPage = Boolean(opts.withPage);

    const tahunRaw = Number.parseInt(query.tahun, 10);
    const filter = {
      // `tahun` benar-benar opsional: tanpa parameter yang sah, TIDAK ada
      // filter tahun sama sekali (seluruh data ikut terhitung), bukan jatuh ke
      // tahun berjalan seperti modul SKP yang punya kontrak YoY per tahun.
      tahun: Number.isInteger(tahunRaw) && tahunRaw >= 2000 && tahunRaw <= 2100
        ? tahunRaw
        : null,
      kdUpt: query.kd_upt ? normalizeUptCode(query.kd_upt) : null,
      kdProvinsi: query.kd_provinsi ? normalizeProvinceCode(query.kd_provinsi) : null,
    };

    if (withPage) {
      const search = query.search ? String(query.search).trim() : '';
      filter.search = search ? search.slice(0, 100) : null;

      const page = Number.parseInt(query.page, 10);
      const limit = Number.parseInt(query.limit, 10);

      filter.page = Number.isInteger(page) && page > 0 ? page : 1;
      filter.limit = Number.isInteger(limit) && limit > 0
        ? Math.min(limit, SpdiPascaService.#MAX_LIMIT)
        : 10;
    }

    return filter;
  }

  /**
   * Mengubah hasil agregasi numerik MySQL (string) menjadi number dengan dua
   * desimal; NULL/`NaN` menjadi `null` agar frontend bisa membedakan "kosong"
   * dari "nol".
   *
   * @param {unknown} value Nilai mentah.
   * @returns {number|null}
   */
  static #toNumber(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
  }

  /**
   * Memecah kumpulan string `kbli` menjadi frekuensi per kode untuk Donut
   * Chart.
   *
   * Satu baris bisa berisi `"47215, 52102"`; tiap kode dihitung sebagai satu
   * frekuensi pada baris itu. Irisan di luar `#KBLI_TOP_N` terbesar digabung
   * ke bucket `Lainnya` supaya chart tetap terbaca; urutan slice teratas
   * stabil (frekuensi DESC lalu kode ASC).
   *
   * @param {Array<{kbli: string|null}>} rows Hasil `getAllKbli`.
   * @returns {Array<{kode: string, total: number}>} Seri donut siap kirim.
   */
  static #buildKbliDistribution(rows) {
    const counts = new Map();

    for (const row of rows) {
      const codes = String(row.kbli ?? '')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean);

      for (const code of codes) {
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }

    const sorted = [...counts.entries()]
      .map(([kode, total]) => ({ kode, total }))
      .sort((a, b) => b.total - a.total || a.kode.localeCompare(b.kode));

    if (sorted.length <= SpdiPascaService.#KBLI_TOP_N) {
      return sorted;
    }

    const top = sorted.slice(0, SpdiPascaService.#KBLI_TOP_N);
    const restTotal = sorted
      .slice(SpdiPascaService.#KBLI_TOP_N)
      .reduce((sum, item) => sum + item.total, 0);

    top.push({ kode: 'Lainnya', total: restTotal });
    return top;
  }

  /**
   * Data lengkap dashboard SPDI: metrik, tren, kontribusi UPT, sebaran
   * provinsi, dan distribusi KBLI.
   *
   * Lima query saling bebas sehingga dijalankan paralel lewat `Promise.all`;
   * wall-clock-nya setara satu query terlama, bukan jumlah kelimanya.
   *
   * @param {Object} query `req.query` berisi `kd_upt`, `kd_provinsi`, `tahun`.
   * @returns {Promise<Object>} Payload dashboard siap kirim.
   */
  static async getDashboardData(query) {
    const filter = SpdiPascaService.#parseFilters(query);

    const [summary, trends, byUpt, byProvinsi, kbliRows] = await Promise.all([
      SpdiPascaRepository.getSummaryMetrics(filter),
      SpdiPascaRepository.getMonthlyTrend(filter),
      SpdiPascaRepository.getByUpt(filter),
      SpdiPascaRepository.getByProvinsi(filter),
      SpdiPascaRepository.getAllKbli(filter),
    ]);

    return {
      filters: {
        tahun: filter.tahun,
        kd_upt: filter.kdUpt,
        kd_provinsi: filter.kdProvinsi,
      },
      metrics: {
        totalData: Number(summary.totalData) || 0,
        totalTerbit: Number(summary.totalTerbit) || 0,
        totalUnit: Number(summary.totalUnit) || 0,
        avgSkorInspeksi: SpdiPascaService.#toNumber(summary.avgSkorInspeksi),
        avgSkorCdib: SpdiPascaService.#toNumber(summary.avgSkorCdib),
        avgSlaHari: SpdiPascaService.#toNumber(summary.avgSlaHari),
      },
      monthlyTrend: trends.map((row) => ({
        bulan: row.bulan,
        total: Number(row.total) || 0,
      })),
      byUpt: byUpt.map((row) => ({
        kd_upt: normalizeUptCode(row.kd_upt),
        nama_upt: sanitizeLabel(row.nama_upt) || 'Tidak Diisi',
        total: Number(row.total) || 0,
        avgSkorInspeksi: SpdiPascaService.#toNumber(row.avgSkorInspeksi),
        avgSkorCdib: SpdiPascaService.#toNumber(row.avgSkorCdib),
      })),
      byProvinsi: byProvinsi.map((row) => ({
        kd_provinsi: row.kd_provinsi,
        // Nama dari kode BPS supaya label peta konsisten; kolom `provinsi`
        // DB berisi teks bebas ("KAB. BUNGO, JAMBI") yang tidak cocok untuk
        // tooltip GeoJSON, jadi dipakai hanya sebagai cadangan.
        nama_provinsi:
          provinceNameFromCode(row.kd_provinsi) || sanitizeLabel(row.nama_provinsi) || null,
        total: Number(row.total) || 0,
      })),
      kbliDistribution: SpdiPascaService.#buildKbliDistribution(kbliRows),
    };
  }

  /**
   * Daftar unit SPDI berpaginasi dengan pencarian dan filter.
   *
   * Default paginasi: `page = 1`, `limit = 10`. Metadata `totalPages` dihitung
   * di sini agar repository tetap murni akses data.
   *
   * @param {Object} query `req.query` berisi `page`, `limit`, `search`,
   * `kd_upt`, `kd_provinsi`, `tahun`.
   * @returns {Promise<{data: Array<Object>, meta: Object}>}
   */
  static async getUnitList(query) {
    const filter = SpdiPascaService.#parseFilters(query, { withPage: true });

    const { rows, count } = await SpdiPascaRepository.findPaginatedList({
      filter: {
        kdUpt: filter.kdUpt,
        kdProvinsi: filter.kdProvinsi,
        tahun: filter.tahun,
      },
      search: filter.search,
      page: filter.page,
      limit: filter.limit,
    });

    const totalPages = filter.limit > 0 ? Math.ceil(count / filter.limit) : 0;

    return {
      data: rows.map((row) => SpdiPascaService.#mapRow(row)),
      meta: {
        total: count,
        page: filter.page,
        limit: filter.limit,
        totalPages,
      },
    };
  }

  /**
   * Memetakan satu baris tabel ke bentuk keluar API.
   *
   * Label teks (unit, UPT, produk) dilewatkan `sanitizeLabel` karena data
   * transaksi proyek ini terbukti bisa memuat newline. Angka DESIMAL yang
   * dikembalikan mysql2 sebagai string dinormalkan ke number; `sla_hari`
   * tetap `null` bila sertifikat belum terbit.
   *
   * @param {Object} row Baris mentah dari repository.
   * @returns {Object} Baris siap kirim.
   */
  static #mapRow(row) {
    return {
      id: Number(row.id),
      nama_unit: sanitizeLabel(row.nama_unit) || null,
      tgl_permohonan: row.tgl_permohonan,
      tgl_terbit: row.tgl_terbit,
      nomor_sertifikat: row.nomor_sertifikat ? String(row.nomor_sertifikat).trim() : null,
      kd_upt: normalizeUptCode(row.kd_upt),
      nama_upt: sanitizeLabel(row.nama_upt) || null,
      kd_provinsi: normalizeProvinceCode(row.kd_provinsi) || (row.kd_provinsi ? String(row.kd_provinsi).trim() : null),
      kab_kota: sanitizeLabel(row.kab_kota) || null,
      skor_inspeksi: SpdiPascaService.#toNumber(row.skor_inspeksi),
      skor_cdib: SpdiPascaService.#toNumber(row.skor_cdib),
      tagging_kdmp: sanitizeLabel(row.tagging_kdmp) || null,
      kbli: sanitizeLabel(row.kbli) || null,
      produk: sanitizeLabel(row.produk) || null,
      status: sanitizeLabel(row.status) || null,
      sla_hari: row.sla_hari === null ? null : Number(row.sla_hari),
    };
  }
}

export default SpdiPascaService;
