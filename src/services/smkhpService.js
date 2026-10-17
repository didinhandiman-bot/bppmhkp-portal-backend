import ExportRepository from '../repositories/smkhpRepository.js';
import UptMasterService from './uptMasterService.js';
import { TRANSACTION_UPT_CODE_COLUMN, TRANSACTION_UPT_NAME_COLUMN } from '../utils/uptCode.js';

class ExportService {

  /**
   * Menggeser tanggal (YYYY-MM-DD) sebanyak `deltaTahun` tahun.
   * Tanggal 29 Februari pada tahun non-kabisat disesuaikan ke hari terakhir bulan.
   *
   * @param {string} dateStr Tanggal format YYYY-MM-DD.
   * @param {number} deltaTahun Jumlah tahun (boleh negatif).
   * @returns {string|null} Tanggal hasil pergeseran, atau null bila format tidak valid.
   */
  static #shiftYear(dateStr, deltaTahun) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? '').trim());
    if (!match) {
      return null;
    }

    const tahun = Number(match[1]) + deltaTahun;
    const bulan = Number(match[2]);
    const hari = Number(match[3]);

    const hariTerakhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
    const hariAman = Math.min(hari, hariTerakhir);

    const yyyy = String(tahun).padStart(4, '0');
    const mm = String(bulan).padStart(2, '0');
    const dd = String(hariAman).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Mengambil data KPI periode pembanding (1 tahun sebelumnya) untuk kalkulasi YoY.
   *
   * Mengembalikan juga `totalNilaiRupiah` agar badge hero memakai pemindaian
   * tabel yang sama, bukan query terpisah.
   *
   * @param {Object} filters Filter aktif (harus memuat startDate & endDate).
   * @returns {Promise<Object>} Row aggregate KPI periode sebelumnya.
   */
  static async #getPreviousPeriodKpi(filters) {
    const { startDate, endDate } = filters;

    const emptyPeriod = {
      totalNilaiRupiah: 0,
      totalNettoKg: 0,
      totalSertifikatHc: 0,
      totalTraderAktif: 0,
      totalNegaraTujuan: 0,
    };

    if (!startDate || !endDate) {
      return emptyPeriod;
    }

    const previousStartDate = ExportService.#shiftYear(startDate, -1);
    const previousEndDate = ExportService.#shiftYear(endDate, -1);

    if (!previousStartDate || !previousEndDate) {
      return emptyPeriod;
    }

    const row = await ExportRepository.getKpiSummary({
      ...filters,
      startDate: previousStartDate,
      endDate: previousEndDate,
    });

    return {
      totalNilaiRupiah: Number(row?.totalNilaiRupiah) || 0,
      totalNettoKg: Number(row?.totalNettoKg) || 0,
      totalSertifikatHc: Number(row?.totalSertifikatHc) || 0,
      totalTraderAktif: Number(row?.totalTraderAktif) || 0,
      totalNegaraTujuan: Number(row?.totalNegaraTujuan) || 0,
    };
  }

  /**
   * Menghitung persentase YoY secara aman (menghindari pembagian nol).
   *
   * Pembanding nol tidak dapat dihitung sebagai rasio, sehingga adopts
   * +100% bila periode aktif sudah berisi data (pertumbuhan dari nol) dan
   * 0% bila keduanya kosong. Hasilnya dibulatkan 2 desimal.
   *
   * @param {number} current Nilai periode aktif.
   * @param {number} previous Nilai periode pembanding.
   * @returns {number} Persentase YoY.
   */
  static #calcYoY(current, previous) {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return Math.round(((current - previous) / previous) * 10000) / 100;
  }

  /**
   * Ambil KPI Summary dari repository + kalkulasi tambahan (termasuk YoY).
   */
  static async getKpiSummary(filters = {}) {
    const [data, previous] = await Promise.all([
      ExportRepository.getKpiSummary(filters),
      ExportService.#getPreviousPeriodKpi(filters),
    ]);

    // Kalkulasi tonase
    const totalNettoTon = Math.round((data.totalNettoKg / 1000) * 100) / 100;
    const prevTotalNettoTon = Math.round((previous.totalNettoKg / 1000) * 100) / 100;

    // Year-over-Year nyata: bandingkan total nilai rentang aktif dengan rentang
    // yang sama persis setahun sebelumnya. Bila pembanding nol, persentase = 0
    // (sesuai semantik badge hero: tanpa basis pembanding tidak ada pertumbuhan).
    const currentTotal = Number(data.totalNilaiRupiah) || 0;
    const previousTotal = previous.totalNilaiRupiah;
    const percentage =
      previousTotal > 0
        ? Math.round(((currentTotal - previousTotal) / previousTotal) * 10000) / 100
        : 0;

    return {
      heroInsight: {
        totalDevisaRupiah: data.totalNilaiRupiah,
        totalDevisaUsd: data.totalNilaiUsd,
        percentage,
      },
      kpiCards: {
        totalNettoKg: data.totalNettoKg,
        totalNettoTon: totalNettoTon,
        totalDokumenAju: data.totalDokumenAju,
        totalSertifikatHc: data.totalSertifikatHc,
        totalUpiAktif: data.totalUpiAktif,
        totalTraderAktif: data.totalTraderAktif,
        totalNegaraTujuan: data.totalNegaraTujuan,
        yoy: {
          tonase: ExportService.#calcYoY(totalNettoTon, prevTotalNettoTon),
          dokumenHc: ExportService.#calcYoY(
            Number(data.totalSertifikatHc) || 0,
            previous.totalSertifikatHc
          ),
          eksportirAktif: ExportService.#calcYoY(
            Number(data.totalTraderAktif) || 0,
            previous.totalTraderAktif
          ),
          negaraTujuan: ExportService.#calcYoY(
            Number(data.totalNegaraTujuan) || 0,
            previous.totalNegaraTujuan
          ),
        },
      },
    };
  }

  /**
   * Ambil daftar DISTINCT nama UPT dari tabel transaksi.
   *
   * Dipertahankan untuk frontend versi lama. Dropdown sebaiknya memakai
   * `UptMasterService.getOptions()` karena hanya master `hc.tb_r_upt` yang
   * memuat kode unit.
   */
  static async getUpts(filters = {}) {
    const rows = await ExportRepository.getUpts(filters);

    return rows.map((row) => ({ nama_upt: row.nama_upt }));
  }

  /**
   * Rekap kontribusi tiap UPT, lengkap dengan nama dari master.
   *
   * Baris transaksi dibaca dari `report_siapmutu`, sedangkan nama UPT diambil
   * dari `hc.tb_r_upt` lewat cache in-memory. Bucket `01.0`/`01.00` sudah
   * digabung oleh repository menjadi satu baris `15.0`, sehingga rekap ini
   * selalu mengembalikan satu entitas per UPT tanpa nama yang kembar.
   *
   * @param {Object} filters Filter aktif.
   * @returns {Promise<object[]>} Daftar `{ kode_upt, nama_upt, … }`.
   */
  static async getUptBreakdown(filters = {}) {
    const rows = await ExportRepository.getUptBreakdown(filters);
    const labels = await UptMasterService.getLabelMap();

    return rows.map((row) => ({
      ...row,
      [TRANSACTION_UPT_NAME_COLUMN]:
        labels.get(row[TRANSACTION_UPT_CODE_COLUMN]) ?? row[TRANSACTION_UPT_NAME_COLUMN] ?? null,
      totalNettoTon: Math.round(((Number(row.totalNettoKg) || 0) / 1000) * 100) / 100,
    }));
  }

  /**
   * Ambil tren bulanan + konversi ke tonase.
   */
  static async getMonthlyTrends(filters = {}) {
    const rawData = await ExportRepository.getMonthlyTrends(filters);

    const result = rawData.map((row) => ({
      bulan: row.bulan,
      totalNettoKg: Number(row.totalNettoKg) || 0,
      totalNettoTon: Math.round(((Number(row.totalNettoKg) || 0) / 1000) * 100) / 100,
      totalNilaiRupiah: Number(row.totalNilaiRupiah) || 0,
      totalDokumenHc: Number(row.totalDokumenHc) || 0,
    }));

    return result;
  }

  /**
   * Ambil top negara tujuan + hitung pangsa pasar.
   */
  static async getTopDestinations(filters = {}, limit = 5) {
    const rawData = await ExportRepository.getTopDestinations(filters, limit);

    const totalDevisaTop = rawData.reduce(
      (sum, row) => sum + (Number(row.totalNilaiRupiah) || 0),
      0
    );

    const result = rawData.map((row) => {
      const share =
        totalDevisaTop > 0
          ? Math.round(((Number(row.totalNilaiRupiah) || 0) / totalDevisaTop) * 10000) / 100
          : 0;

      return {
        kode_negara_partner: row.kode_negara_partner,
        negara_tujuan: row.negara_tujuan,
        totalNilaiRupiah: Number(row.totalNilaiRupiah) || 0,
        totalNettoKg: Number(row.totalNettoKg) || 0,
        sharePersentase: share,
      };
    });

    return result;
  }

  /**
   * Ambil analisis komoditas (siap untuk chart).
   */
  static async getCommodityAnalytics(filters = {}) {
    const data = await ExportRepository.getCommodityAnalytics(filters);

    return {
      rasioTawarLaut: Array.isArray(data.rasioTawarLaut)
        ? data.rasioTawarLaut.map((r) => ({
            kategori: r.tawar_laut,
            totalNettoKg: Number(r.totalNettoKg) || 0,
            totalNettoTon: Math.round(((Number(r.totalNettoKg) || 0) / 1000) * 100) / 100,
          }))
        : [],
      rasioKonsumsi: Array.isArray(data.rasioKonsumsi)
        ? data.rasioKonsumsi.map((r) => ({
            kategori: r.konsumsi,
            totalNettoKg: Number(r.totalNettoKg) || 0,
            totalNettoTon: Math.round(((Number(r.totalNettoKg) || 0) / 1000) * 100) / 100,
          }))
        : [],
      topKomoditas: Array.isArray(data.topKomoditas)
        ? data.topKomoditas.map((r) => ({
            kel_ikan: r.kel_ikan,
            totalNettoKg: Number(r.totalNettoKg) || 0,
            totalNettoTon: Math.round(((Number(r.totalNettoKg) || 0) / 1000) * 100) / 100,
            totalNilaiRupiah: Number(r.totalNilaiRupiah) || 0,
          }))
        : [],
    };
  }

  /**
   * Ambil daftar transaksi dengan paginasi.
   *
   * Setelah baris diambil dari `report_siapmutu`, `nama_upt` diganti dengan
   * `NM_PENDEK_BARU` dari master `hc.tb_r_upt` berdasarkan `kode_upt`. Kode
   * legacy `01.00`/`01.0` ikut dinormalkan menjadi `15.0`, dan baris yang
   * kodenya tidak dikenal di master tetap memakai `nama_upt` dari transaksi.
   */
  static async getTransactions(filters, pagination = {}) {
    const { page = 1, limit = 10, search = '' } = pagination;

    const result = await ExportRepository.getTransactions(filters, {
      page,
      limit,
      search,
    });

    const totalRecords = Number(result.meta?.total || 0);
    const data = await UptMasterService.applyToRows(
      Array.isArray(result.data) ? result.data : []
    );

    return {
      data,
      meta: {
        totalRecords,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalRecords / Number(limit)),
      },
    };
  }
}

export default ExportService;
