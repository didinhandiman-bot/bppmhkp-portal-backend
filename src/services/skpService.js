import SkpRepository from '../repositories/skpRepository.js';
import {
  BUCKET_SKALA_USAHA,
  NAMA_BULAN,
  calcYoYGrowth,
  getDefaultYear,
  sanitizeLabel,
} from '../utils/skpGrouping.js';

/**
 * Service Modul SKP (Sertifikasi Kelayakan Pengolahan) - Pasca Panen.
 *
 * Tugas service di sini bukan menulis SQL, melainkan merapikan hasil agregasi
 * MySQL: mengubah angka yang kembali sebagai string menjadi number, memastikan
 * deret tren selalu 12 elemen, dan menyusun label yang aman ditampilkan.
 *
 * Mengikuti bentuk `smkhp` di repo ini: kelas dengan method `static`, diekspor
 * sebagai kelas (bukan instance) dan dipanggil sebagai `SkpService.xxx()`.
 */
class SkpService {
  /**
   * Batas `limit` untuk paginasi tabel.
   *
   * Tanpa batas atas, `?limit=100000` akan menarik seluruh tabel ke memori.
   */
  static #MAX_LIMIT = 100;

  /**
   * Nilai `status` yang diterima pada filter tabel.
   */
  static #VALID_STATUS = ['aktif', 'expired', 'expiring_soon'];

  /**
   * Membersihkan dan memvalidasi query string menjadi objek filter.
   *
   * Semua nilai dari `req.query` adalah string; di sini dinormalkan supaya
   * repository menerima tipe yang benar (tahun dan limit jadi number) dan nilai
   * di luar daftar yang sah langsung dibuang, bukan diteruskan ke SQL.
   *
   * @param {Object} query `req.query`.
   * @param {Object} [opts] Opsi tambahan `{ withPage }` untuk menyertakan paginasi.
   * @returns {Object} Filter tervalidasi.
   */
  static #parseFilters(query = {}, opts = {}) {
    const withPage = Boolean(opts.withPage);

    const year = Number.parseInt(query.year, 10);
    const safeYear = Number.isInteger(year) && year >= 2000 && year <= 2100
      ? year
      : getDefaultYear();

    const filter = {
      year: safeYear,
      kdUnit: query.kd_unit || query.kdUnit || query.kd_upt || query.uptId || null,
      provinsiId: query.provinsiId ? String(query.provinsiId).trim() : null,
      skalaUsaha: null,
      peringkat: null,
      search: null,
      status: null,
    };

    // `skalaUsaha` hanya menerima empat bucket kanonik. Nilai mentah tabel
    // ("Usaha Mikro : <= 1.000.000.000") tidak pernah sampai ke sini karena
    // frontend mengirim bucket hasil normalisasi.
    const skalaUsaha = query.skalaUsaha ? String(query.skalaUsaha).trim() : '';
    if (BUCKET_SKALA_USAHA.includes(skalaUsaha)) {
      filter.skalaUsaha = skalaUsaha;
    }

    // `peringkat` adalah char(1); dinormalkan ke huruf besar agar "a" tetap cocok.
    const peringkat = query.peringkat ? String(query.peringkat).trim().toUpperCase() : '';
    if (/^[A-Z]$/.test(peringkat)) {
      filter.peringkat = peringkat;
    }

    if (withPage) {
      const search = query.search ? String(query.search).trim() : '';
      // Batasi panjang search agar tidak ada klausa LIKE yang sia-sia.
      if (search) {
        filter.search = search.slice(0, 100);
      }

      const status = query.status ? String(query.status).trim() : '';
      if (SkpService.#VALID_STATUS.includes(status)) {
        filter.status = status;
      }

      const page = Number.parseInt(query.page, 10);
      const limit = Number.parseInt(query.limit, 10);

      filter.page = Number.isInteger(page) && page > 0 ? page : 1;
      filter.limit = Number.isInteger(limit) && limit > 0
        ? Math.min(limit, SkpService.#MAX_LIMIT)
        : 10;
      filter.offset = (filter.page - 1) * filter.limit;

      filter.sortBy = query.sortBy ? String(query.sortBy).trim() : 'tanggal_terbit';
      filter.sortOrder = query.sortOrder ? String(query.sortOrder).trim() : 'DESC';
    }

    return filter;
  }

  /**
   * Metrik ringkasan dashboard: total penerbitan, YoY, status, dan jumlah UPI.
   *
   * @param {Object} query `req.query` berisi `year`, `provinsiId`, `skalaUsaha`, `peringkat`.
   * @returns {Promise<Object>} Objek metrik siap kirim ke frontend.
   */
  static async getSummaryMetrics(query) {
    const filter = SkpService.#parseFilters(query);
    const row = await SkpRepository.findSummaryMetrics(filter);

    // MySQL2 mengembalikan COUNT() sebagai string (kecuali pada konfigurasi
    // tertentu). Semua angka dinormalkan di sini agar frontend tidak menerima
    // "2687" dan salah menjumlahkannya.
    const totalTerbit = Number(row?.totalTerbit) || 0;
    const totalTerbitPrevYear = Number(row?.totalTerbitPrevYear) || 0;

    return {
      year: filter.year,
      previousYear: filter.year - 1,
      totalTerbit,
      totalTerbitPrevYear,
      yoyGrowth: calcYoYGrowth(totalTerbit, totalTerbitPrevYear),
      totalAktif: Number(row?.totalAktif) || 0,
      totalExpired: Number(row?.totalExpired) || 0,
      totalUpi: Number(row?.totalUpi) || 0,
      filters: {
        provinsiId: filter.provinsiId,
        skalaUsaha: filter.skalaUsaha,
        peringkat: filter.peringkat,
      },
    };
  }

  /**
   * Deret waktu bulanan 12 bulan untuk tahun berjalan dan pembandingnya.
   *
   * Hasil SQL hanya berisi bulan yang punya data; method ini mengisinya menjadi
   * 12 elemen agar frontend tidak perlu menangani array berlubang. Bulan tanpa
   * data bernilai 0, bukan null, supaya garis line chart tidak terputus.
   *
   * @param {Object} query `req.query` berisi `year`, `provinsiId`.
   * @returns {Promise<Object>} `{ year, previousYear, data: [12 item] }`.
   */
  static async getMonthlyTrends(query) {
    const filter = SkpService.#parseFilters(query);
    const rows = await SkpRepository.findMonthlyTrends(filter);

    const year = filter.year;
    const previousYear = year - 1;

    // Akumulasikan hasil SQL ke peta `${tahun}-${bulan}` supaya pencarian O(1).
    const counts = new Map();
    for (const row of rows) {
      const key = `${Number(row.tahun)}-${Number(row.bulan)}`;
      counts.set(key, Number(row.total) || 0);
    }

    const data = NAMA_BULAN.map((monthName, index) => {
      const month = index + 1;
      return {
        month,
        monthName,
        currentYear: counts.get(`${year}-${month}`) || 0,
        previousYear: counts.get(`${previousYear}-${month}`) || 0,
      };
    });

    return {
      year,
      previousYear,
      totalCurrentYear: data.reduce((sum, item) => sum + item.currentYear, 0),
      totalPreviousYear: data.reduce((sum, item) => sum + item.previousYear, 0),
      data,
    };
  }

  /**
   * Distribusi SKP untuk grafik ringkasan.
   *
   * @param {Object} query `req.query` berisi `year`, `provinsiId`.
   * @returns {Promise<Object>} Empat kelompok distribusi.
   */
  static async getDistribution(query) {
    const filter = SkpService.#parseFilters(query);
    const result = await SkpRepository.findDistribution(filter);

    const toSeries = (rows) => rows.map((row) => ({
      label: sanitizeLabel(row.label) || 'Tidak Diisi',
      total: Number(row.total) || 0,
    }));

    return {
      year: filter.year,
      byPeringkat: toSeries(result.byPeringkat),
      bySkalaUsaha: toSeries(result.bySkalaUsaha),
      topJenisOlahan: toSeries(result.topJenisOlahan),
      // Peringkat wilayah tidak berguna ketika dashboard sudah difilter ke satu
      // provinsi: hasilnya hanya satu baris. Kembalikan array kosong agar
      // frontend bisa menyembunyikan panel tanpa percabangan tambahan.
      topWilayah: filter.provinsiId ? [] : toSeries(result.topWilayah),
    };
  }

  /**
   * Daftar SKP berpaginasi dengan pencarian dan filter.
   *
   * Dua query dijalankan bersamaan lewat `Promise.all`: satu penghitung baris
   * untuk `totalRows`, satu pengambilan isi halaman. Keduanya memakai filter
   * yang identik sehingga angka paginasi tidak pernah meleset dari isi tabel.
   *
   * @param {Object} query `req.query` berisi paginasi, `search`, dan filter.
   * @returns {Promise<Object>} `{ data, pagination }`.
   */
  static async getTableList(query) {
    const filter = SkpService.#parseFilters(query, { withPage: true });

    const [totalRows, rows] = await Promise.all([
      SkpRepository.countTableList(filter),
      SkpRepository.findTableList(filter),
    ]);

    const totalPages = filter.limit > 0 ? Math.ceil(totalRows / filter.limit) : 0;

    return {
      data: rows.map((row) => SkpService.#mapRow(row)),
      pagination: {
        totalRows,
        totalPages,
        currentPage: filter.page,
        limit: filter.limit,
      },
    };
  }

  /**
   * Memetakan satu baris tabel ke bentuk keluar API.
   *
   * Label yang bisa berisi newline (`nama_upi`, `nama_produk`, `provinsi`,
   * `kota_kabupaten`) dilewatkan `sanitizeLabel`. Field yang boleh null di
   * database diteruskan apa adanya, bukan diganti string kosong, agar frontend
   * bisa membedakan "kosong" dari "tidak ada".
   *
   * @param {Object} row Baris mentah dari repository.
   * @returns {Object} Baris siap kirim.
   */
  static #mapRow(row) {
    return {
      id: Number(row.id),
      nama_upi: sanitizeLabel(row.nama_upi),
      nib: row.nib ? String(row.nib).trim() : null,
      provinsi_id: row.provinsi_id,
      provinsi: sanitizeLabel(row.provinsi),
      regency_id: row.regency_id,
      kota_kabupaten: sanitizeLabel(row.kota_kabupaten),
      alamat: sanitizeLabel(row.alamat),
      skala_usaha: row.skala_usaha ? String(row.skala_usaha).trim() : null,
      jenis_permohonan: row.jenis_permohonan ? String(row.jenis_permohonan).trim() : null,
      tanggal_pengajuan: row.tanggal_pengajuan,
      tanggal_rekomendasi: row.tanggal_rekomendasi,
      tanggal_terbit: row.tanggal_terbit,
      tanggal_kadaluarsa: row.tanggal_kadaluarsa,
      nomor_skp: row.nomor_skp ? String(row.nomor_skp).trim() : null,
      nama_produk: sanitizeLabel(row.nama_produk),
      jenis_olahan: row.jenis_olahan ? String(row.jenis_olahan).trim() : null,
      peringkat: row.peringkat ? String(row.peringkat).trim() : null,
      status: row.status_skp,
    };
  }
}

export default SkpService;
