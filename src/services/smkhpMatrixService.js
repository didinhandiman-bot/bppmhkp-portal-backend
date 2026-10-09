import ExportRepository from '../repositories/smkhpRepository.js';
import {
  groupDestination,
  groupProduct,
  MAIN_DESTINATIONS,
} from '../utils/exportGrouping.js';

/** Pemisah internal untuk kunci komposit (destinasi × produk). */
const KEY_SEP = '\u0000';

/** Membulatkan ke 2 desimal (dipakai nilai USD Juta). */
function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Membulatkan ke 1 desimal (dipakai persentase YoY / share). */
function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

/**
 * Service dua matriks ekspor:
 * 1. Produk Utama di Negara Tujuan (`top-products-by-destination`).
 * 2. Pasar Utama per Produk (`top-destinations-by-product`).
 *
 * Kedua tampilan membaca himpunan baris granular yang sama
 * (`negara_tujuan × kel_ikan` → nilai USD), lalu mengelompokkannya di memori.
 * Nilai USD = `nilai_rupiah / kurs_usd` terakumulasi (tabel tidak memuat
 * kolom `nilai_usd`), dan template angka mengikuti kontrak: nilai dalam
 * Juta USD bulat 2 desimal, YoY & persentase bulat 1 desimal.
 */
class ExportMatrixService {

  /**
   * Menyelesaikan rentang periode dari query.
   *
   * Urutan prioritas:
   * 1. `startDate` + `endDate` eksplisit (YYYY-MM-DD);
   * 2. `tahun` (+ opsional `bulan` 1-12);
   * 3. default: YTD berjalan (1 Januari tahun ini sampai hari ini).
   *
   * @param {Object} filters Filter mentah dari controller.
   * @returns {{ startDate: string, endDate: string }} Rentang inklusif.
   */
  static resolvePeriod(filters = {}) {
    const startDate = String(filters.startDate ?? '').trim();
    const endDate = String(filters.endDate ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return { startDate, endDate };
    }

    const tahunRaw = String(filters.tahun ?? '').trim();
    if (/^\d{4}$/.test(tahunRaw)) {
      const tahun = Number(tahunRaw);
      const bulanRaw = String(filters.bulan ?? '').trim();
      if (/^\d{1,2}$/.test(bulanRaw)) {
        const bulan = Math.min(12, Math.max(1, Number(bulanRaw)));
        const yyyy = String(tahun).padStart(4, '0');
        const mm = String(bulan).padStart(2, '0');
        const hariTerakhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
        return { startDate: `${yyyy}-${mm}-01`, endDate: `${yyyy}-${mm}-${String(hariTerakhir).padStart(2, '0')}` };
      }
      return { startDate: `${tahun}-01-01`, endDate: `${tahun}-12-31` };
    }

    const now = new Date();
    const Y = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    return { startDate: `${Y}-01-01`, endDate: `${Y}-${MM}-${DD}` };
  }

  /**
   * Menggeser tanggal (YYYY-MM-DD) sebanyak `delta` tahun.
   * 29 Februari pada tahun non-kabisat disesuaikan ke akhir bulan.
   *
   * @param {string} dateStr Tanggal format YYYY-MM-DD.
   * @param {number} delta Tahun yang digeser (boleh negatif).
   * @returns {string|null} Tanggal hasil; null bila format tidak valid.
   */
  static shiftYear(dateStr, delta) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? '').trim());
    if (!match) {
      return null;
    }
    const tahun = Number(match[1]) + delta;
    const bulan = Number(match[2]);
    const hari = Number(match[3]);
    const hariTerakhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
    const yyyy = String(tahun).padStart(4, '0');
    const mm = String(bulan).padStart(2, '0');
    const dd = String(Math.min(hari, hariTerakhir)).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Menghitung persentase YoY secara aman.
   *
   * `previous` nol tidak bisa menjadi penyebut rasio, sehingga hasilnya 0
   * (tidak ada basis pembanding = tidak ada pertumbuhan yang dapat diukur).
   *
   * @param {number} current Nilai periode aktif.
   * @param {number} previous Nilai periode pembanding (1 tahun sebelumnya).
   * @returns {number} Persentase YoY, bulat 1 desimal.
   */
  static calcYoY(current, previous) {
    const prev = Number(previous) || 0;
    const cur = Number(current) || 0;
    if (prev <= 0) {
      return 0;
    }
    return round1(((cur - prev) / prev) * 100);
  }

  /**
   * Membangun indeks agregat dari baris granular.
   *
   * Satu baris mentah `{ negara_tujuan, kel_ikan, value_usd }` dicatat ke
   * empat struktur sekaligus agar kedua tampilan bisa memakai bagian yang
   * sama tanpa query tambahan:
   * - `nationalTotal`: total nasional (penyebut share).
   * - `byDestProduct`: nilai per (bucket destinasi, keluarga produk).
   * - `destTotals`:     nilai per bucket destinasi.
   * - `productTotals`:  nilai per keluarga produk.
   * - `productDest`:    nilai per (keluarga produk, bucket destinasi). Bucket
   *                     memakai `groupDestination`, sehingga anggota ASEAN dan
   *                     Uni Eropa sudah dilebur menjadi satu entitas ("ASEAN",
   *                     "Uni Eropa") SEBELUM ranking Top 5 dilakukan.
   *
   * @param {object[]} rows Baris granular.
   * @returns {object} Indeks agregat.
   */
  static #buildIndex(rows) {
    /** @type {number} */
    let nationalTotal = 0;
    /** @type {Map<string, number>} */
    const byDestProduct = new Map();
    /** @type {Map<string, number>} */
    const destTotals = new Map();
    /** @type {Map<string, number>} */
    const productTotals = new Map();
    /** @type {Map<string, Map<string, number>>} */
    const productDest = new Map();

    const add = (map, key, value) => map.set(key, (map.get(key) || 0) + value);

    for (const row of rows) {
      const rawCountry = String(row?.negara_tujuan ?? '').trim();
      if (rawCountry === '') {
        continue;
      }
      const value = Number(row?.value_usd) || 0;
      if (!(value > 0)) {
        continue;
      }

      const dest = groupDestination(rawCountry);
      const prod = groupProduct(row?.kel_ikan);

      nationalTotal += value;
      add(byDestProduct, dest + KEY_SEP + prod, value);
      add(destTotals, dest, value);
      add(productTotals, prod, value);

      let destByProduct = productDest.get(prod);
      if (!destByProduct) {
        destByProduct = new Map();
        productDest.set(prod, destByProduct);
      }
      // Kunci memakai bucket kawasan (`dest`), bukan negara tunggal, agar
      // anggota ASEAN/Uni Eropa dijumlahkan menjadi satu entitas dan tidak
      // lolos sebagai negara individual ke Top 5 pasar tujuan.
      add(destByProduct, dest, value);
    }

    return { nationalTotal, byDestProduct, destTotals, productTotals, productDest };
  }

  /**
   * Ambil nilai gabungan dari indeks lintas-tampilan.
   *
   * @param {Map<string, number>} map Peta komposit.
   * @param {string} first Kunci pertama (destinasi atau produk).
   * @param {string} second Kunci kedua (produk atau destinasi).
   * @returns {number} Nilai agregat (0 bila belum ada).
   */
  static #valueAt(map, first, second) {
    return map.get(first + KEY_SEP + second) || 0;
  }

  /**
   * Membaca indeks periode berjalan dan periode pembanding YoY.
   *
   * @param {Object} filters Filter mentah.
   * @returns {Promise<{ current: object, previous: object, periodo: object }>}
   */
  static async #loadMatrixData(filters = {}) {
    const periodo = ExportMatrixService.resolvePeriod(filters);
    const previous = {
      startDate: ExportMatrixService.shiftYear(periodo.startDate, -1),
      endDate: ExportMatrixService.shiftYear(periodo.endDate, -1),
    };

    const currentFilters = { ...filters, startDate: periodo.startDate, endDate: periodo.endDate };
    const previousFilters = { ...filters, ...previous };

    const [currentRows, previousRows] = await Promise.all([
      ExportRepository.getMatrixGranular(currentFilters),
      ExportRepository.getMatrixGranular(previousFilters),
    ]);

    return {
      current: ExportMatrixService.#buildIndex(currentRows),
      previous: ExportMatrixService.#buildIndex(previousRows),
      periodo,
      previousPeriodo: previous,
    };
  }

  /**
   * Tampilan 1: Produk Utama di Negara Tujuan.
   *
   * Selalu memuat 5 destinasi utama (Amerika Serikat, Tiongkok, ASEAN, Jepang,
   * Uni Eropa). Per destinasi: total nilai USD Juta, YoY, share terhadap total
   * nasional, dan 4-5 produk teratas beserta YoY serta share dalam destinasi.
   *
   * @param {Object} filters Filter mentah.
   * @param {{ productsLimit?: number }} [options] Batas produk per destinasi.
   * @returns {Promise<{ destinations: object[], periode: object, previousPeriode: object }>}
   */
  static async getMatrixTopProductsByDestination(filters = {}, options = {}) {
    const productsLimit = Math.max(1, Math.min(10, Number(options.productsLimit) || 5));
    const { current, previous, periodo, previousPeriodo } = await ExportMatrixService.#loadMatrixData(filters);

    const nationalTotal = current.nationalTotal;

    const destinations = MAIN_DESTINATIONS.map((destination) => {
      const destValue = current.destTotals.get(destination) || 0;
      const previousDestValue = previous.destTotals.get(destination) || 0;

      // Produk milik destinasi ini, diurutkan menurun.
      const products = [];
      for (const [key, value] of current.byDestProduct) {
        const sep = key.indexOf(KEY_SEP);
        if (sep === -1) continue;
        const destKey = key.slice(0, sep);
        if (destKey !== destination) continue;
        products.push({ product_name: key.slice(sep + 1), value_usd: value });
      }
      products.sort((a, b) => b.value_usd - a.value_usd);

      return {
        destination,
        total_value_usd_juta: round2(destValue / 1e6),
        yoy_percentage: ExportMatrixService.calcYoY(destValue, previousDestValue),
        share_negara_percentage: nationalTotal > 0 ? round1((destValue / nationalTotal) * 100) : 0,
        top_products: products.slice(0, productsLimit).map((product) => {
          const previousProductValue = ExportMatrixService.#valueAt(
            previous.byDestProduct,
            destination,
            product.product_name
          );
          return {
            product_name: product.product_name,
            value_usd_juta: round2(product.value_usd / 1e6),
            yoy_percentage: ExportMatrixService.calcYoY(product.value_usd, previousProductValue),
            share_percentage: destValue > 0 ? round1((product.value_usd / destValue) * 100) : 0,
          };
        }),
      };
    });

    return { destinations, periode: periodo, previousPeriode: previousPeriodo };
  }

  /**
   * Tampilan 2: Pasar Utama per Produk.
   *
   * Produk dipilih dari total nilai nasional (default 6 teratas). Per produk:
   * total nilai USD Juta, YoY, share terhadap total nasional, dan 5 pasar
   * tujuan teratas (kawasan/negara) beserta YoY serta share dalam produk.
   *
   * Pasar tujuan dikelompokkan ke bucket kawasan lebih dulu (`groupDestination`
   * di `#buildIndex`) — seluruh anggota ASEAN menjadi satu entitas "ASEAN" dan
   * seluruh anggota Uni Eropa menjadi satu entitas "Uni Eropa" — lalu dijumlah
   * ulang (nilai USD, YoY, share) dan diurutkan menurun hingga Top 5. Dengan
   * begitu negara anggota (Malaysia, Singapore, Thailand, Vietnam, Italia,
   * Jerman, Prancis, Denmark, dsb.) tidak pernah muncul sebagai pasar tunggal.
   *
   * @param {Object} filters Filter mentah.
   * @param {{ productsLimit?: number, destinationsLimit?: number }} [options]
   * @returns {Promise<{ products: object[], periode: object, previousPeriode: object }>}
   */
  static async getMatrixTopDestinationsByProduct(filters = {}, options = {}) {
    const productsLimit = Math.max(1, Math.min(15, Number(options.productsLimit) || 6));
    const destinationsLimit = Math.max(1, Math.min(10, Number(options.destinationsLimit) || 5));
    const { current, previous, periodo, previousPeriodo } = await ExportMatrixService.#loadMatrixData(filters);

    const nationalTotal = current.nationalTotal;

    // Keluarga produk diurutkan menurun berdasarkan total nasional.
    const products = [...current.productTotals.entries()]
      .map(([product_name, value_usd]) => ({ product_name, value_usd }))
      .sort((a, b) => b.value_usd - a.value_usd)
      .slice(0, productsLimit);

    return {
      products: products.map((product) => {
        const productValue = product.value_usd;
        const previousProductValue = previous.productTotals.get(product.product_name) || 0;

        const destinations = [...(current.productDest.get(product.product_name) || new Map()).entries()]
          .map(([destination, value_usd]) => ({
            destination,
            value_usd,
          }))
          .sort((a, b) => b.value_usd - a.value_usd)
          .slice(0, destinationsLimit)
          .map((entry) => {
            const previousCountryValue =
              previous.productDest.get(product.product_name)?.get(entry.destination) || 0;
            return {
              destination: entry.destination,
              value_usd_juta: round2(entry.value_usd / 1e6),
              yoy_percentage: ExportMatrixService.calcYoY(entry.value_usd, previousCountryValue),
              share_percentage: productValue > 0 ? round1((entry.value_usd / productValue) * 100) : 0,
            };
          });

        return {
          product_name: product.product_name,
          total_value_usd_juta: round2(productValue / 1e6),
          yoy_percentage: ExportMatrixService.calcYoY(productValue, previousProductValue),
          share_product_percentage: nationalTotal > 0 ? round1((productValue / nationalTotal) * 100) : 0,
          top_destinations: destinations,
        };
      }),
      periode: periodo,
      previousPeriode: previousPeriodo,
    };
  }
}

export default ExportMatrixService;