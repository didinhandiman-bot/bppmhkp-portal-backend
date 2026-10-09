/**
 * Utilitas pengelompokan untuk matriks ekspor.
 *
 * Menyajikan dua tampilan analitik lintas-variabel (produk vs negara tujuan)
 * membutuhkan satu aturan pengelompokan:
 * - negara tujuan dikelompokkan ke label kawasan/negara utama (ASEAN,
 *   "Uni Eropa", "Amerika Serikat", dsb.), dan
 * - `kel_ikan` mentah (mis. "Udang Vaname", "Daging Rajungan") dilebur ke
 *   keluarga komoditas ("Udang", "Rajungan-Kepiting").
 *
 * Seluruh fungsi murni (pure) dan deterministik, sehingga bucket yang sama
 * dipakai oleh matriks periode berjalan maupun periode pembanding YoY.
 * Nilai di database memakai ejaan campuran (huruf besar/kecil serta tanda
 * hubung), karena itu semua masukan dinormalkan dulu ke huruf besar tanpa
 * spasi berlebih/tanda hubung sebelum dicocokkan.
 */

/** 5 destinasi utama pada Tampilan 1, dalam urutan tampilan yang diinginkan. */
export const MAIN_DESTINATIONS = Object.freeze(['Amerika Serikat', 'Tiongkok', 'ASEAN', 'Jepang', 'Uni Eropa']);

/** Nama negara utama yang diterjemahkan ke Bahasa Indonesia untuk tampilan. */
const COUNTRY_CURATED = Object.freeze({
  'UNITED STATES': 'Amerika Serikat',
  USA: 'Amerika Serikat',
  'U.S.A': 'Amerika Serikat',
  CHINA: 'Tiongkok',
  JAPAN: 'Jepang',
});

/**
 * Anggota ASEAN (versi penyimpanan di DB, sudah dinormalkan tanpa hubung).
 * `MYANMAR`/`BURMA` serta `CAMBODIA`/`KAMPUCHEA` disediakan dua-duanya untuk
 * menangkap variasi ejaan lama.
 */
const ASEAN_COUNTRIES = new Set([
  'MALAYSIA',
  'PHILIPPINES',
  'SINGAPORE',
  'THAILAND',
  'BRUNEI DARUSSALAM',
  'VIETNAM',
  'LAOS',
  'MYANMAR',
  'BURMA',
  'CAMBODIA',
  'KAMPUCHEA',
  'TIMOR LESTE',
]);

/** Anggota Uni Eropa (27 anggota saat ini), versi DB yang sudah dinormalkan. */
const EU_COUNTRIES = new Set([
  'AUSTRIA',
  'BELGIUM',
  'BULGARIA',
  'CROATIA',
  'CYPRUS',
  'CZECH REPUBLIC',
  'DENMARK',
  'ESTONIA',
  'FINLAND',
  'FRANCE',
  'GERMANY',
  'GREECE',
  'HUNGARY',
  'IRELAND',
  'ITALY',
  'LATVIA',
  'LITHUANIA',
  'LUXEMBOURG',
  'MALTA',
  'NETHERLANDS',
  'POLAND',
  'PORTUGAL',
  'ROMANIA',
  'SLOVAKIA',
  'SLOVAK REPUBLIC',
  'SLOVENIA',
  'SPAIN',
  'SWEDEN',
]);

/**
 * Menormalkan nama negara menjadi kunci pencocokan.
 *
 * Spasi berlebih diringkas, tanda hubung diperlakukan sebagai spasi
 * (sehingga `TIMOR-LESTE` dan `TIMOR LESTE` dianggap sama), lalu diubah
 * menjadi huruf besar.
 *
 * @param {unknown} value Nama negara mentah.
 * @returns {string} Kunci pencocokan; string kosong bila input kosong.
 */
export function normalizeCountryKey(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/[\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Mengubah teks menjadi Title Case sederhana (huruf pertama tiap kata kapital).
 * Dipakai menampilkan nama negara tunggal yang tidak punya terjemahan.
 *
 * @param {unknown} value Teks mentah dari database.
 * @returns {string} Teks berformat Title Case; string kosong bila input kosong.
 */
export function titleCase(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .trim()
    .replace(/[A-Za-zÀ-ž']+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * Label tampilan untuk satu negara tujuan (bukan kelompok).
 *
 * Negara utama diterjemahkan ke Bahasa Indonesia ("Amerika Serikat",
 * "Tiongkok", "Jepang"); negara lain ditampilkan Title Case sesuai penyimpanan.
 *
 * @param {unknown} value Nama negara mentah.
 * @returns {string} Label negara siap tampil; string kosong bila input kosong.
 */
export function singleCountryLabel(value) {
  const key = normalizeCountryKey(value);
  if (key === '') {
    return '';
  }
  return COUNTRY_CURATED[key] ?? titleCase(value);
}

/**
 * Mengelompokkan negara tujuan ke bucket tampilan.
 *
 * Urutan prioritas: ASEAN, Uni Eropa, lalu negara utama terjemahan,
 * selain itu negara itu sendiri (Title Case). Seluruh anggota ASEAN/UE
 * selalu dikelompokkan ke label kawasan sehingga tidak muncul duplikat.
 *
 * @param {unknown} value Nama negara mentah dari transaksi.
 * @returns {string} Label bucket destinasi.
 */
export function groupDestination(value) {
  const key = normalizeCountryKey(value);
  if (key === '') {
    return '';
  }
  if (ASEAN_COUNTRIES.has(key)) {
    return 'ASEAN';
  }
  if (EU_COUNTRIES.has(key)) {
    return 'Uni Eropa';
  }
  return COUNTRY_CURATED[key] ?? titleCase(value);
}

/**
 * Menormalkan nama komoditas mentah.
 *
 * @param {unknown} value Nilai `kel_ikan` mentah.
 * @returns {string} Nama komoditas yang sudah dirapikan; string kosong bila kosong.
 */
export function normalizeProductKey(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Mengelompokkan `kel_ikan` mentah ke keluarga komoditas.
 *
 * Aturan berbasis kata persis/awalan agar variasi penyimpanan ("Udang Vaname",
 * "Udang Windu", "Daging Rajungan") masuk ke satu keluarga yang sama dengan
 * label yang dipakai laporan. `kel_ikan` yang tidak terpetakan dipertahankan
 * apa adanya (sudah dirapikan).
 *
 * @param {unknown} value Nilai `kel_ikan` mentah.
 * @returns {string} Label produk siap tampil.
 */
export function groupProduct(value) {
  const key = normalizeProductKey(value);
  if (key === '') {
    return '';
  }
  if (key.startsWith('udang')) {
    return 'Udang';
  }
  if (['tuna', 'cakalang', 'tuna cakalang'].includes(key)) {
    return 'Tuna-Cakalang';
  }
  if (['cumi', 'cumi-cumi', 'sotong', 'gurita'].includes(key)) {
    return 'Cumi-Sotong-Gurita';
  }
  if (['rajungan', 'daging rajungan', 'kepiting', 'daging kepiting'].includes(key)) {
    return 'Rajungan-Kepiting';
  }
  if (['rumput laut', 'olahan rumput laut', 'carrageenan', 'olahan rumput laut (carrageenan)'].includes(key)) {
    return 'Rumput Laut';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}