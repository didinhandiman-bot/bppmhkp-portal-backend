import ExportRepository from '../repositories/smkhpRepository.js';
import UptMasterService from './uptMasterService.js';
import { TRANSACTION_UPT_CODE_COLUMN, TRANSACTION_UPT_NAME_COLUMN } from '../utils/uptCode.js';

class ExportService {
  /** Membulatkan angka ke 2 tempat desimal secara aman. */
  static #round2(value) {
    const num = Number(value) || 0;
    return Math.round(num * 100) / 100;
  }

  /** Mengonversi satuan kilogram menjadi ton (dibulatkan 2 desimal). */
  static #kgToTon(kg) {
    return ExportService.#round2((Number(kg) || 0) / 1000);
  }

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
   * Basis metrik dokumen memakai `totalDokumenAju` (COUNT DISTINCT nomor_aju).
   *
   * @param {Object} filters Filter aktif (harus memuat startDate & endDate).
   * @returns {Promise<Object>} Row aggregate KPI periode sebelumnya.
   */
  static async #getPreviousPeriodKpi(filters) {
    const { startDate, endDate } = filters;

    const emptyPeriod = {
      totalNilaiRupiah: 0,
      totalNettoKg: 0,
      totalDokumenAju: 0,
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
      totalDokumenAju: Number(row?.totalDokumenAju) || 0,
      totalTraderAktif: Number(row?.totalTraderAktif) || 0,
      totalNegaraTujuan: Number(row?.totalNegaraTujuan) || 0,
    };
  }

  /**
   * Menghitung persentase YoY secara aman (menghindari pembagian nol).
   *
   * Pembanding nol tidak dapat dihitung sebagai rasio, sehingga mengadopsi
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
    return ExportService.#round2(((current - previous) / previous) * 100);
  }

  /**
   * Ambil KPI Summary dari repository + kalkulasi tambahan (termasuk YoY).
   *
   * Metrik jumlah dokumen memakai basis unik `nomor_aju` (`totalDokumenAju`)
   * agar seragam dengan Dashboard Overview, Breakdown UPT, dan sistem legacy.
   */
  static async getKpiSummary(filters = {}) {
    const [data, previous] = await Promise.all([
      ExportRepository.getKpiSummary(filters),
      ExportService.#getPreviousPeriodKpi(filters),
    ]);

    const totalNettoTon = ExportService.#kgToTon(data.totalNettoKg);
    const prevTotalNettoTon = ExportService.#kgToTon(previous.totalNettoKg);

    const currentTotal = Number(data.totalNilaiRupiah) || 0;
    const previousTotal = previous.totalNilaiRupiah;
    const percentage =
      previousTotal > 0
        ? ExportService.#round2(((currentTotal - previousTotal) / previousTotal) * 100)
        : 0;

    const totalDokumenAju = Number(data.totalDokumenAju) || 0;
    const totalTraderAktif = Number(data.totalTraderAktif) || 0;
    const totalNegaraTujuan = Number(data.totalNegaraTujuan) || 0;

    return {
      heroInsight: {
        totalDevisaRupiah: currentTotal,
        totalDevisaUsd: Number(data.totalNilaiUsd) || 0,
        percentage,
      },
      kpiCards: {
        totalNettoKg: Number(data.totalNettoKg) || 0,
        totalNettoTon,
        totalDokumenAju,
        totalSertifikatHc: totalDokumenAju,
        totalUpiAktif: Number(data.totalUpiAktif) || 0,
        totalTraderAktif,
        totalNegaraTujuan,
        yoy: {
          tonase: ExportService.#calcYoY(totalNettoTon, prevTotalNettoTon),
          dokumenHc: ExportService.#calcYoY(totalDokumenAju, previous.totalDokumenAju),
          eksportirAktif: ExportService.#calcYoY(totalTraderAktif, previous.totalTraderAktif),
          negaraTujuan: ExportService.#calcYoY(totalNegaraTujuan, previous.totalNegaraTujuan),
        },
      },
    };
  }

  /**
   * Ambil daftar DISTINCT nama UPT dari tabel transaksi.
   */
  static async getUpts(filters = {}) {
    const rows = await ExportRepository.getUpts(filters);
    return rows.map((row) => ({ nama_upt: row.nama_upt }));
  }

  /**
   * Rekap kontribusi tiap UPT, lengkap dengan nama dari master `hc.tb_r_upt`.
   */
  static async getUptBreakdown(filters = {}) {
    const rows = await ExportRepository.getUptBreakdown(filters);
    const labels = await UptMasterService.getLabelMap();

    return rows.map((row) => ({
      ...row,
      [TRANSACTION_UPT_NAME_COLUMN]:
        labels.get(row[TRANSACTION_UPT_CODE_COLUMN]) ?? row[TRANSACTION_UPT_NAME_COLUMN] ?? null,
      totalNettoTon: ExportService.#kgToTon(row.totalNettoKg),
    }));
  }

  /**
   * Ambil tren bulanan + konversi ke tonase.
   */
  static async getMonthlyTrends(filters = {}) {
    const rawData = await ExportRepository.getMonthlyTrends(filters);

    return rawData.map((row) => ({
      bulan: row.bulan,
      totalNettoKg: Number(row.totalNettoKg) || 0,
      totalNettoTon: ExportService.#kgToTon(row.totalNettoKg),
      totalNilaiRupiah: Number(row.totalNilaiRupiah) || 0,
      totalDokumenHc: Number(row.totalDokumenHc) || 0,
    }));
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

    return rawData.map((row) => {
      const nilaiRupiah = Number(row.totalNilaiRupiah) || 0;
      const share =
        totalDevisaTop > 0
          ? ExportService.#round2((nilaiRupiah / totalDevisaTop) * 100)
          : 0;

      return {
        kode_negara_partner: row.kode_negara_partner,
        negara_tujuan: row.negara_tujuan,
        totalNilaiRupiah: nilaiRupiah,
        totalNettoKg: Number(row.totalNettoKg) || 0,
        sharePersentase: share,
      };
    });
  }

  /**
   * Ambil analisis komoditas (siap untuk chart).
   */
  static async getCommodityAnalytics(filters = {}) {
    const data = await ExportRepository.getCommodityAnalytics(filters);

    const mapKategori = (rows, keyField) =>
      Array.isArray(rows)
        ? rows.map((r) => ({
            kategori: r[keyField],
            totalNettoKg: Number(r.totalNettoKg) || 0,
            totalNettoTon: ExportService.#kgToTon(r.totalNettoKg),
          }))
        : [];

    return {
      rasioTawarLaut: mapKategori(data.rasioTawarLaut, 'tawar_laut'),
      rasioKonsumsi: mapKategori(data.rasioKonsumsi, 'konsumsi'),
      topKomoditas: Array.isArray(data.topKomoditas)
        ? data.topKomoditas.map((r) => ({
            kel_ikan: r.kel_ikan,
            totalNettoKg: Number(r.totalNettoKg) || 0,
            totalNettoTon: ExportService.#kgToTon(r.totalNettoKg),
            totalNilaiRupiah: Number(r.totalNilaiRupiah) || 0,
          }))
        : [],
    };
  }

  /**
   * Ambil daftar transaksi dengan paginasi.
   */
  static async getTransactions(filters, pagination = {}) {
    const page = Number(pagination.page) || 1;
    const limit = Number(pagination.limit) || 10;
    const search = pagination.search ?? '';

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
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit),
      },
    };
  }
}

export default ExportService;