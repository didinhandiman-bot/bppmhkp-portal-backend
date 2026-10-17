/**
 * Utilitas kode provinsi BPS (2 digit) & pemetaan nama provinsi.
 *
 * Endpoint peta sebaran menggabungkan data dari empat skema berbeda, dan
 * masing-masing menyimpan provinsi dengan cara yang tidak seragam:
 *
 * - `report_skp.tb_skp_paska.provinsi_id` -> sudah kode BPS 2 digit (`"32"`).
 * - `report_kapal.tb_cbib_kapal.kode_provinsi` -> sudah kode BPS 2 digit (`"32"`).
 * - `report_primer.tr_laporan_primer_export.uraian_propinsi` -> NAMA provinsi
 *   (`"JAWA BARAT"`). Tabel ini TIDAK punya kolom `kode_provinsi`, dan
 *   `kd_daerah` tidak bisa dipakai sebagai sumber kode: nilainya kotor
 *   (contoh `1906000000` muncul untuk DI Yogyakarta, Jawa Timur, Kalimantan
 *   Tengah, Bangka Belitung, dan Kepulauan Riau sekaligus), sehingga prefiks
 *   dua digitnya menyesatkan.
 * - `report_haccp.vw07_sertifikasi.nm_provinsi` -> NAMA provinsi. Kolom
 *   `id_provinsi` di view itu adalah indeks surrogat (1..38) yang URUTANNYA
 *   BUKAN urutan kode BPS (33 = Papua Barat, 34 = Papua), jadi tidak boleh
 *   dipakai sebagai kode.
 *
 * Karena itu file ini menjadi satu-satunya tempat yang tahu aturan pemetaan
 * nama -> kode maupun penyeragaman kode. Repository tetap mengembalikan nilai
 * mentah; service yang memanggil helper di sini supaya nilai yang keluar
 * selalu berupa kode BPS 2 digit — persis `properties.KODE_PROV` pada
 * GeoJSON `38-Provinsi-Indonesia.json` milik frontend.
 *
 * Daftar nama kanonik sengaja memuat 38 provinsi (termasuk empat provinsi
 * hasil pemekaran Papua pada 2022) supaya peta bisa menampilkan seluruh
 * wilayah, bukan hanya provinsi yang kebetulan punya data tahun ini.
 */

/**
 * Daftar kanonik provinsi: nama tampilan -> kode BPS 2 digit.
 *
 * Urut berdasarkan kode. Dipakai sebagai sumber kedua arah (nama -> kode dan
 * kode -> nama) sehingga tidak ada dua daftar yang bisa saling bertentangan.
 *
 * @type {ReadonlyMap<string, string>}
 */
export const PROVINCE_NAME_BY_CODE = new Map([
  ['11', 'Aceh'],
  ['12', 'Sumatera Utara'],
  ['13', 'Sumatera Barat'],
  ['14', 'Riau'],
  ['15', 'Jambi'],
  ['16', 'Sumatera Selatan'],
  ['17', 'Bengkulu'],
  ['18', 'Lampung'],
  ['19', 'Kepulauan Bangka Belitung'],
  ['21', 'Kepulauan Riau'],
  ['31', 'DKI Jakarta'],
  ['32', 'Jawa Barat'],
  ['33', 'Jawa Tengah'],
  ['34', 'DI Yogyakarta'],
  ['35', 'Jawa Timur'],
  ['36', 'Banten'],
  ['51', 'Bali'],
  ['52', 'Nusa Tenggara Barat'],
  ['53', 'Nusa Tenggara Timur'],
  ['61', 'Kalimantan Barat'],
  ['62', 'Kalimantan Tengah'],
  ['63', 'Kalimantan Selatan'],
  ['64', 'Kalimantan Timur'],
  ['65', 'Kalimantan Utara'],
  ['71', 'Sulawesi Utara'],
  ['72', 'Sulawesi Tengah'],
  ['73', 'Sulawesi Selatan'],
  ['74', 'Sulawesi Tenggara'],
  ['75', 'Gorontalo'],
  ['76', 'Sulawesi Barat'],
  ['81', 'Maluku'],
  ['82', 'Maluku Utara'],
  ['91', 'Papua'],
  ['92', 'Papua Barat'],
  ['93', 'Papua Selatan'],
  ['94', 'Papua Tengah'],
  ['95', 'Papua Pegunungan'],
  ['96', 'Papua Barat Daya'],
]);

/**
 * Alias ejaan nama provinsi yang muncul di data nyata maupun yang lazim
 * dipakai, dipetakan ke nama kanonik di atas. Kuncinya juga dinormalkan
 * lewat `normalizeProvinceName`, jadi cukup ditulis apa adanya.
 *
 * @type {ReadonlyMap<string, string>}
 */
const PROVINCE_NAME_ALIASES = new Map([
  ['Daerah Istimewa Yogyakarta', 'DI Yogyakarta'],
  ['Yogyakarta', 'DI Yogyakarta'],
  ['Bangka Belitung', 'Kepulauan Bangka Belitung'],
  ['Kep. Bangka Belitung', 'Kepulauan Bangka Belitung'],
  ['Jakarta', 'DKI Jakarta'],
  ['Nanggroe Aceh Darussalam', 'Aceh'],
  ['NAD', 'Aceh'],
  ['Kep. Riau', 'Kepulauan Riau'],
  ['Irian Jaya', 'Papua'],
]);

/**
 * Menormalkan nama provinsi menjadi kunci pencarian.
 *
 * Data empat skema memakai huruf besar/kecil yang berbeda dan sesekali
 * menyisipkan spasi ganda; tanpa penyeragaman, "Jawa Barat" dan "JAWA BARAT"
 * akan terhitung sebagai dua provinsi berbeda.
 *
 * @param {unknown} value Nama provinsi mentah.
 * @returns {string} Nama huruf besar, tanpa tanda baca/spasi berlebih.
 */
export function normalizeProvinceName(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @type {Map<string, string>} Nama ternormalisasi -> kode BPS. */
const CODE_BY_NORMALIZED_NAME = new Map();

for (const [code, name] of PROVINCE_NAME_BY_CODE) {
  CODE_BY_NORMALIZED_NAME.set(normalizeProvinceName(name), code);
}

// Alias didaftarkan setelah nama kanonik supaya tidak pernah menimpanya.
for (const [alias, canonical] of PROVINCE_NAME_ALIASES) {
  const code = CODE_BY_NORMALIZED_NAME.get(normalizeProvinceName(canonical));
  if (code) {
    CODE_BY_NORMALIZED_NAME.set(normalizeProvinceName(alias), code);
  }
}

/**
 * Mengubah nama provinsi menjadi kode BPS 2 digit.
 *
 * @param {unknown} value Nama provinsi mentah dari database.
 * @returns {string|null} Kode 2 digit, atau `null` bila nama tidak dikenali.
 */
export function provinceCodeFromName(value) {
  const key = normalizeProvinceName(value);
  if (key === '') {
    return null;
  }

  const direct = CODE_BY_NORMALIZED_NAME.get(key);
  if (direct) {
    return direct;
  }

  // Sebagian sumber menuliskan prefiks "Provinsi", mis. "PROVINSI JAWA BARAT".
  if (key.startsWith('PROVINSI ')) {
    return CODE_BY_NORMALIZED_NAME.get(key.slice('PROVINSI '.length)) ?? null;
  }

  return null;
}

/**
 * Menormalkan kode provinsi yang sudah berupa angka menjadi 2 digit.
 *
 * Kode dari `tb_skp_paska.provinsi_id`/`tb_cbib_kapal.kode_provinsi` sudah 2
 * digit, tetapi penyeragaman ini menjaga kontrak payload tetap konsisten
 * (`"5"` -> `"05"`) bila suatu saat sumbernya berubah.
 *
 * @param {unknown} value Kode provinsi mentah.
 * @returns {string|null} Kode 2 digit, atau `null` bila bukan angka 1-2 digit.
 */
export function normalizeProvinceCode(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!/^\d{1,2}$/.test(raw)) {
    return null;
  }

  return raw.padStart(2, '0');
}

/**
 * Mengambil nama tampilan kanonik dari kode BPS.
 *
 * @param {unknown} code Kode provinsi (boleh 2 digit atau angka).
 * @returns {string|null} Nama kanonik, atau `null` bila kode tidak dikenal.
 */
export function provinceNameFromCode(code) {
  const normalized = normalizeProvinceCode(code);
  if (normalized === null) {
    return null;
  }
  return PROVINCE_NAME_BY_CODE.get(normalized) ?? null;
}
