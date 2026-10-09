import PrimerRepository from '../repositories/primerRepository.js';

/**
 * Service modul Primer (laporan perizinan primer).
 *
 * Lapisan ini memegang seluruh logika bisnis dan pembentukan bentuk respons;
 * repository hanya boleh mengembalikan baris mentah dari database. Yang
 * dikerjakan di sini:
 *
 * - Menjalankan beberapa kueri secara paralel untuk halaman ringkasan.
 * - Menerjemahkan kolom database (VARCHAR, snake_case, penuh baris kosong)
 *   menjadi bentuk yang enak dipakai frontend.
 * - Mengamankan nilai angka: kolom `total_*` di database bertipe VARCHAR, jadi
 *   harus diubah ke number supaya frontend tidak melakukan parse berulang.
 * - Menghitung metadata pagination.
 * - Menyusun keluaran CSV untuk endpoint unduhan.
 *
 * Kolom `total_*` sengaja dibiarkan `null` bila tidak terbaca angka, bukan
 * diganti 0. Nilai 0 berarti "benar-benar nol", sedangkan `null` berarti
 * "tidak punya data" — keduanya berbeda arti di grafik.
 */

/** Batas maksimum baris per halaman untuk endpoint tabular. */
const MAX_PAGE_SIZE = 100;

/** Ukuran chunk saat menarik data untuk diekspor. */
const EXPORT_CHUNK_SIZE = 2000;

/**
 * Pengaman atas jumlah baris yang boleh diekspor dalam satu permintaan.
 *
 * Ekspor diambil dengan mengulang query berpage, jadi tanpa batas ini satu
 * permintaan bisa menahan seluruh tabel di memori. Batas ini cukup longgar untuk
 * 957 baris saat ini, dan sengaja ada supaya tidak meledak saat data
 * bertumbuh.
 */
const EXPORT_MAX_ROWS = 50000;

const BULAN_PENDEK = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
];

/** Nama berkas unduhan, tanpa ekstensi. */
function buildExportBaseName(filters) {
  const year = filters.startDate ? String(filters.startDate).slice(0, 4) : 'semua';
  return `primer-sertifikat-${year}`;
}

class PrimerService {
  /**
   * Bersihkan teks dari karakter kontrol.
   *
   * Data upstream sering memuat newline dan carriage return di dalam nama
   * perusahaan atau provinsi. Kalau diteruskan apa adanya ke frontend, layout
   * tabel rusak; kalau masuk ke CSV tanpa dibersihkan, satu sel jadi beberapa
   * baris dan file-nya tidak bisa dibuka sebagai tabel.
   *
   * @param {*} value - nilai apa pun
   * @returns {string|null} teks bersih, atau null bila kosong
   */
  static #clean(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return s === '' ? null : s;
  }

  /**
   * Ubah nilai database menjadi number yang aman dipanggil frontend.
   *
   * @param {*} value - nilai dari database, kemungkinan string
   * @returns {number|null} angka, atau null bila tidak bisa dibaca
   */
  static #num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Ubah nilai menjadi number dengan fallback, untuk kolom yang memang selalu
   * harus punya angka (mis. jumlah sertifikat).
   *
   * @param {*} value
   * @param {number} fallback
   * @returns {number}
   */
  static #numOr(value, fallback = 0) {
    const n = this.#num(value);
    return n === null ? fallback : n;
  }

  /**
   * Bulatkan angka untuk tampilan, menghindari deretan desimal panjang dari
   * hasil `AVG` pada kolom VARCHAR.
   *
   * @param {*} value
   * @param {number} digits
   * @returns {number|null}
   */
  static #round(value, digits = 2) {
    const n = this.#num(value);
    if (n === null) return null;
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  }

  /**
   * Susun filter bersih yang akan diteruskan ke repository.
   *
   * Nilai yang tidak valid dibuang seluruhnya di sini agar repository tidak
   * pernah menerima tipe yang tidak diharapkan. Satu-satunya pengecualian adalah
   * `kdIzin`, yang memang ditangani repository lewat whitelist.
   *
   * @param {object} raw - query mentah dari controller
   * @returns {object} filter ternormalisasi
   */
  static #normalizeFilters(raw = {}) {
    const out = {};

    if (raw.startDate) out.startDate = String(raw.startDate).slice(0, 10);
    if (raw.endDate) out.endDate = String(raw.endDate).slice(0, 10);

    if (out.startDate && out.endDate && out.startDate > out.endDate) {
      // Tanggal terbalik ditukar, bukan dibuang, supaya filter dari frontend
      // yang salah urutan tidak ikut membuat layar kosong tanpa penjelasan.
      const tmp = out.startDate;
      out.startDate = out.endDate;
      out.endDate = tmp;
    }

    if (raw.kdIzin) out.kdIzin = String(raw.kdIzin).trim();
    if (raw.kdDaerah) out.kdDaerah = String(raw.kdDaerah).trim();

    if (raw.search) {
      const s = String(raw.search).trim().slice(0, 100);
      if (s) out.search = s;
    }

    return out;
  }

  /**
   * Tentukan tahun untuk query tren bulanan.
   *
   * Kalau rentang tanggal diberikan, tahun diambil dari tanggal awal supaya
   * tren selalu sejalan dengan angka KPI di layar yang sama. Tanpa rentang
   * tanggal, dipakai tahun berjalan.
   *
   * @param {object} filters - filter yang sudah ternormalisasi
   * @returns {number} empat digit tahun
   */
  static #resolveYear(filters) {
    const fromRange = filters.startDate ? Number(String(filters.startDate).slice(0, 4)) : NaN;
    if (Number.isInteger(fromRange) && fromRange >= 1900 && fromRange <= 2999) return fromRange;
    return new Date().getFullYear();
  }

  /**
   * Ringkasan KPI beserta data grafik untuk halaman dashboard.
   *
   * Ketiga kueri saling bebas dan tidak bergantung satu sama lain, jadi
   * dijalankan bersamaan. Total waktu halaman_then turun dari jumlah waktu
   * ketiga kueri menjadi hanya kueri yang paling lambat.
   *
   * @param {object} rawFilters - filter dari query string
   * @returns {Promise<object>} bentuk siap kirim ke frontend
   */
  static async getDashboardOverview(rawFilters = {}) {
    const filters = this.#normalizeFilters(rawFilters);
    const year = this.#resolveYear(filters);
    const kdIzin = (filters.kdIzin || '').trim();

    if (kdIzin === '032000000033') {
      const [metrics, trenBulanan, distribusiGrade, segmenGT, topAlatTangkap, topPelabuhan, sebaranWPP] = await Promise.all([
        PrimerRepository.getKapalSummaryMetrics(filters),
        PrimerRepository.getKapalMonthlyTrends(filters),
        PrimerRepository.getKapalDistributionByGrade(filters),
        PrimerRepository.getKapalGTSegments(filters),
        PrimerRepository.getKapalTopAlatTangkap(filters, 7),
        PrimerRepository.getKapalTopPelabuhan(filters, 10),
        PrimerRepository.getKapalSebaranWPP(filters, 10),
      ]);

      const total = this.#numOr(metrics.totalSertifikat, 0);
      const labelsBulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

      return {
        ringkasan: {
          totalSertifikat: total,
          totalAktif: this.#numOr(metrics.totalAktif, 0),
          totalGT: this.#numOr(metrics.totalGT, 0),
          totalABK: this.#numOr(metrics.totalABK, 0),
        },
        stats: {
          totalSertifikat: total,
          totalAktif: this.#numOr(metrics.totalAktif, 0),
          totalGT: this.#numOr(metrics.totalGT, 0),
          totalABK: this.#numOr(metrics.totalABK, 0),
          tonaseArmada: [
            { label: '< 10 GT', total: segmenGT['<10'] ?? 0 },
            { label: '10 - 30 GT', total: segmenGT['10-30'] ?? 0 },
            { label: '31 - 100 GT', total: segmenGT['31-100'] ?? 0 },
            { label: '> 100 GT', total: segmenGT['>100'] ?? 0 },
          ],
          alatTangkap: (topAlatTangkap || []).map((x) => ({ nama: this.#clean(x.alat_tangkap) ?? this.#clean(x.nama) ?? '(Tidak diketahui)', total: x.total })),
          sebaranWpp: (sebaranWPP || []).map((x) => ({ wpp: this.#clean(x.daerah_tangkap) ?? this.#clean(x.wpp) ?? '(Tidak diketahui)', total: x.total })),
        },
        breakdownHasil: [],
        trenBulanan: (trenBulanan || []).map((b) => {
          const dt = b.periode ? new Date(b.periode + '-01') : null;
          const m = dt ? dt.getMonth() + 1 : null;
          return {
            bulan: m,
            labelBulan: m ? labelsBulan[m - 1] : b.periode,
            total: b.total,
          };
        }),
        distribusiWilayah: [],
        distribusiKomoditas: [],
        distribusiGrade: distribusiGrade.map((g, i) => ({ rank: i + 1, grade: this.#clean(g.grade) ?? 'Non Grade', total: g.total })),
        segmentasiGT: segmenGT,
        topAlatTangkap: (topAlatTangkap || []).map((x) => ({ alat_tangkap: this.#clean(x.alat_tangkap), total: x.total })),
        topPelabuhan: topPelabuhan,
        sebaranWPP: (sebaranWPP || []).map((x) => ({ daerah_tangkap: this.#clean(x.daerah_tangkap), total: x.total })),
        filterEfektif: { ...filters, tahun: year },
      };
    }

    // Jalankan alur existing
    const trenFilter = { ...filters, year };
    const [metrics, trenBulanan, wilayah, komoditas] = await Promise.all([
      PrimerRepository.getSummaryMetrics(filters),
      PrimerRepository.getMonthlyTrends(trenFilter),
      PrimerRepository.getDistributionByProvince({ ...filters, limit: 10 }),
      PrimerRepository.getDistributionByKomoditas({ ...filters, limit: 10 })
    ]);

    const total = this.#numOr(metrics.totalSertifikat, 0);

    return {
      ringkasan: {
        totalSertifikat: total,
        totalEntitas: this.#numOr(metrics.totalEntitas, 0),
        rataEntitasPerSertifikat: total > 0 ? this.#round(this.#numOr(metrics.totalEntitas, 0) / total, 2) : null,
        rataMinor: this.#round(metrics.rataMinor),
        rataMayor: this.#round(metrics.rataMayor),
        rataKritis: this.#round(metrics.rataKritis),
        tglSyncTerakhir: metrics.tglSyncTerakhir,
      },
      breakdownHasil: metrics.breakdownHasil,
      trenBulanan: trenBulanan.map((b) => ({
        bulan: b.bulan,
        labelBulan: BULAN_PENDEK[b.bulan - 1],
        total: b.total
      })),
      distribusiWilayah: wilayah.map((w, i) => ({
        rank: i + 1,
        provinsi: this.#clean(w.provinsi) ?? '(Tidak diketahui)',
        total: w.total,
        persentase: total > 0 ? this.#round((w.total / total) * 100, 2) : null
      })),
      distribusiKomoditas: komoditas.map((c, i) => ({
        rank: i + 1,
        komoditas: this.#clean(c.komoditas) ?? '(Tidak diketahui)',
        total: c.total,
        persentase: total > 0 ? this.#round((c.total / total) * 100, 2) : null
      })),
      filterEfektif: { ...filters, tahun: year }
    };
  }

  static async getCertificateList(query = {}) {
    const filters = this.#normalizeFilters(query);
    const kdIzin = (filters.kdIzin || '').trim();

    const page = Math.max(1, this.#numOr(query.page, 1));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, this.#numOr(query.limit, 20)));

    if (kdIzin === '032000000033') {
      const { rows, count } = await PrimerRepository.findKapalPaginated({
        ...filters,
        page,
        limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder
      });
      const data = rows.map((row) => this.#mapKapalRow(row));
      const totalPages = count > 0 ? Math.ceil(count / limit) : 0;
      return {
        data,
        meta: {
          page,
          limit,
          totalRows: count,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1 && count > 0,
          firstRow: count > 0 ? (page - 1) * limit + 1 : 0,
          lastRow: count > 0 ? Math.min(page * limit, count) : 0
        }
      };
    }

    const { rows, count } = await PrimerRepository.findAllPaginated({
      ...filters,
      page,
      limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder
    });

    const data = rows.map((row) => this.#mapRow(row));
    const totalPages = count > 0 ? Math.ceil(count / limit) : 0;

    return {
      data,
      meta: {
        page,
        limit,
        totalRows: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1 && count > 0,
        firstRow: count > 0 ? (page - 1) * limit + 1 : 0,
        lastRow: count > 0 ? Math.min(page * limit, count) : 0
      }
    };
  }

  static #mapKapalRow(row) {
    const clean = (v) => {
      if (v === null || v === undefined) return null;
      const str = String(v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      return str === '' ? null : str;
    };
    const num = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      id: row.id_cbib,
      idChecklist: null,
      tglIzin: row.tgl_terbit,
      kdIzin: '032000000033',
      jenisIzin: clean(row.tipe_kapal) ?? 'CPIB Kapal',
      namaIzin: 'Cara Penanganan Ikan yang Baik - CPIB Kapal',
      noIzin: clean(row.no_cbib),
      nib: null,
      namaPerseroan: clean(row.nama_kapal),
      alamat: clean(row.nama_pelabuhan),
      provinsi: clean(row.nama_provinsi),
      kdDaerah: clean(row.kode_provinsi),
      komoditas: clean(row.jenis_produk),
      kbli: clean(row.no_kbli),
      statusChecklist: clean(row.status_pemasok),
      stsAktif: row.tgl_kadaluarsa ? (new Date(row.tgl_kadaluarsa).setHours(0,0,0,0) >= new Date().setHours(0,0,0,0) ? 'Aktif' : 'Tidak Aktif') : null,
      statusAktif: row.tgl_kadaluarsa ? (new Date(row.tgl_kadaluarsa) >= new Date()) : false,
      totalSesuai: null,
      totalMinor: null,
      totalMayor: null,
      totalKritis: null,
      totalHasil: clean(row.grade_scpib),
      keterangan: null,
      tglTarikData: row.tgl_tarik_data,
      sumberData: null,
      pemilik: clean(row.nama_pemilik),
      gt: num(row.gt),
      alatTangkap: clean(row.alat_tangkap),
      upt: clean(row.upt_inspeksi),
      tglTerbit: row.tgl_terbit,
      tglKadaluarsa: row.tgl_kadaluarsa,
      masaBerlaku: row.tgl_kadaluarsa,
      noSertifikat: clean(row.no_cbib),
      namaKapal: clean(row.nama_kapal),
      namaPemilik: clean(row.nama_pemilik),
      namaPelabuhan: clean(row.nama_pelabuhan),
      daerahTangkap: clean(row.daerah_tangkap),
      grade: clean(row.grade_scpib),
    };
  }

  static #mapRow(row) {
    return {
      id: row.id_export,
      idChecklist: this.#clean(row.idchecklist),
      tglIzin: row.tgl_izin,
      kdIzin: this.#clean(row.kd_izin),
      jenisIzin: this.#clean(row.ur_izin_singkat) ?? this.#clean(row.jenis_izin),
      namaIzin: this.#clean(row.nama_izin),
      noIzin: this.#clean(row.no_izin),
      nib: this.#clean(row.nib),
      namaPerseroan: this.#clean(row.nama_perseroan),
      alamat: this.#clean(row.alamat_perseroan),
      provinsi: this.#clean(row.uraian_propinsi),
      kdDaerah: this.#clean(row.kd_daerah),
      komoditas: this.#clean(row.komoditas),
      kbli: this.#clean(row.kbli),
      statusChecklist: this.#clean(row.status_checklist),
      stsAktif: this.#clean(row.sts_aktif),
      // Kolom temuan bertipe VARCHAR di database; dikembalikan sebagai angka
      // supaya frontend tidak perlu parse sendiri.
      totalSesuai: this.#num(row.total_sesuai),
      totalMinor: this.#num(row.total_minor),
      totalMayor: this.#num(row.total_mayor),
      totalKritis: this.#num(row.total_kritis),
      totalHasil: this.#clean(row.total_hasil),
      keterangan: this.#clean(row.keterangan),
      tglTarikData: row.tgl_tarik_data,
      sumberData: this.#clean(row.sumber_data)
    };
  }

  /**
   * Susun keluaran CSV untuk diunduh, ditarik per halaman agar tidak menahan
   * seluruh tabel di memori.
   *
   * @param {object} rawFilters - filter dari query string
   * @returns {Promise<{ filename: string, columns: object[], stream: AsyncGenerator<string> }>}
   */
  static async exportCertificateData(rawFilters = {}) {
    const filters = this.#normalizeFilters(rawFilters);

    const columns = [
      { key: 'tglIzin', header: 'Tgl Izin' },
      { key: 'jenisIzin', header: 'Jenis Izin' },
      { key: 'kdIzin', header: 'Kd Izin' },
      { key: 'noIzin', header: 'No Izin' },
      { key: 'nib', header: 'NIB' },
      { key: 'namaPerseroan', header: 'Nama Perseroan' },
      { key: 'provinsi', header: 'Provinsi' },
      { key: 'kdDaerah', header: 'Kd Daerah' },
      { key: 'komoditas', header: 'Komoditas' },
      { key: 'kbli', header: 'KBLI' },
      { key: 'statusChecklist', header: 'Status Checklist' },
      { key: 'totalSesuai', header: 'Total Sesuai' },
      { key: 'totalMinor', header: 'Total Minor' },
      { key: 'totalMayor', header: 'Total Mayor' },
      { key: 'totalKritis', header: 'Total Kritis' },
      { key: 'totalHasil', header: 'Total Hasil' },
      { key: 'tglTarikData', header: 'Tgl Tarik Data' }
    ];

    /**
     * Escape satu sel CSV.
     *
     * DuaLEDGce hal dijaga di sini. Pertama, pemisah dan newline wajib
     * diapit tanda kutip. Kedua, sel yang diawali `=`, `+`, `-`, atau `@`
     * akan dieksekusi sebagai formula oleh Excel saat berkas dibuka — ini
     * formula injection, dan nama perusahaan dari sumber daya eksternal
     * bisa saja berisi payload seperti itu. Sel teks seperti itu diberi
     * awalan tanda kutip tunggal agar Excel memperlakukannya sebagai teks.
     * Sel numerik tidak diberi awalan karena nilainya sudah berupa number.
     */
    const escapeCell = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'number') return String(value);

      let s = String(value);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    async function* stream() {
      let page = 1;
      let exported = 0;
      let lastCount = null;

      do {
        const { rows, count } = await PrimerRepository.findAllPaginated({
          ...filters,
          page,
          limit: EXPORT_CHUNK_SIZE,
          sortBy: 'tgl_izin',
          sortOrder: 'asc'
        });

        lastCount = count;

        if (exported >= EXPORT_MAX_ROWS) break;

        for (const row of rows) {
          if (exported >= EXPORT_MAX_ROWS) {
            yield '\r\n# Dataset dipotong pada ' + EXPORT_MAX_ROWS + ' baris\r\n';
            return;
          }
          const mapped = PrimerService.#mapRow(row);
          yield `${columns.map((c) => escapeCell(mapped[c.key])).join(',')}\r\n`;
          exported += 1;
        }

        page += 1;
      } while ((page - 1) * EXPORT_CHUNK_SIZE < (lastCount ?? 0));
    }

    return {
      filename: `${buildExportBaseName(filters)}.csv`,
      columns,
      stream: stream()
    };
  }
}

export default PrimerService;
