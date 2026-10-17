import { Op } from 'sequelize';
import models from '../models/index.js';

import { TEST_UPT_CODES, isTestUptCode, sanitizeLabel } from '../utils/uptCode.js';

// Handle both `default export` and namespace export patterns
const modelsInstance = models?.default || models;
// `hc` di proyek ini diekspor sebagai `dbMaster` (lihat `models/index.js`).
const { TbRUpt, dbMaster } = modelsInstance || {};

if (!TbRUpt || !dbMaster) {
  throw new Error('TbRUpt / dbMaster not found in models/index.js — check export structure');
}

/**
 * Kolom yang dibaca dari master UPT.
 *
 * `NM_PENDEK_BARU` adalah nama resmi terbaru (mis. "Balai PPMHKP Jakarta").
 * Nama lain hanya dipakai sebagai cadangan berurutan bila kolom ini kosong
 * pada sebagian baris.
 */
const SELECTED_COLUMNS = [
  'KD_UNIT',
  'KD_PROP',
  'NM_PENDEK_BARU',
  'NM_UNIT_BARU',
  'NM_PENDEK',
  'NM_UNIT',
  'KOTA',
  'ALAMAT_UNIT',
  'BUJUR',
  'LINTANG',
  'STS_AKTIF',
];

/**
 * Mengubah nilai kolom koordinat master UPT menjadi angka.
 *
 * Nilai di `BUJUR`/`LINTANG` bertipe VARCHAR dan membawa CR/LF ikutan, jadi
 * harus dibersihkan lebih dulu. Nilai non-numerik dikembalikan `null` supaya
 * baris tanpa koordinat tidak muncul sebagai titik `(0, 0)` di Samudra Atlantik.
 *
 * @param {unknown} value Nilai kolom mentah.
 * @returns {number|null} Koordinat sebagai angka, atau `null` bila tidak valid.
 */
function toCoordinate(value) {
  const raw = sanitizeLabel(value);
  if (raw === '') {
    return null;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * Rentang koordinat yang wajar untuk wilayah Indonesia.
 *
 * Dipakai untuk mendeteksi baris master yang pasangan koordinatnya terbalik:
 * sebagian baris menyimpan longitude di `BUJUR` dan latitude di `LINTANG`,
 * berlawanan dengan konvensi umum tabel ini.
 */
const INDONESIA_LAT_RANGE = [-11.5, 6.5];
const INDONESIA_LNG_RANGE = [94, 142];

/** Apakah pasangan (lat, lng) berada di dalam rentang wajar Indonesia. */
function isWithinIndonesia(lat, lng) {
  return (
    lat >= INDONESIA_LAT_RANGE[0] &&
    lat <= INDONESIA_LAT_RANGE[1] &&
    lng >= INDONESIA_LNG_RANGE[0] &&
    lng <= INDONESIA_LNG_RANGE[1]
  );
}

/**
 * Menentukan (latitude, longitude) akhir dari kolom `BUJUR`/`LINTANG`.
 *
 * Konvensi tabel: `BUJUR` = LATITUDE, `LINTANG` = LONGITUDE (lihat catatan
 * quirk di `normalizeRow`). Akan tetapi ditemukan minimal satu baris master
 * (KD_UNIT `25.0`, Balai PPMHKP Tanjung Pinang) yang menyimpannya TERBALIK,
 * sehingga tafsir lurus menghasilkan `lat = 104.44`. Bila tafsir pertama jatuh
 * di luar rentang wajar Indonesia dan tafsir terbalik masuk akal, pakai yang
 * terbalik. Bila keduanya di luar rentang, kembalikan `null` supaya tidak ada
 * marker nyasar (lebih baik titik hilang daripada titik di lokasi salah).
 *
 * @param {unknown} bujurValue Nilai kolom `BUJUR`.
 * @param {unknown} lintangValue Nilai kolom `LINTANG`.
 * @returns {{ latitude: number|null, longitude: number|null }}
 */
function resolveCoordinates(bujurValue, lintangValue) {
  const lat = toCoordinate(bujurValue);
  const lng = toCoordinate(lintangValue);

  if (lat === null || lng === null) {
    return { latitude: null, longitude: null };
  }
  if (isWithinIndonesia(lat, lng)) {
    return { latitude: lat, longitude: lng };
  }
  if (isWithinIndonesia(lng, lat)) {
    return { latitude: lng, longitude: lat };
  }
  return { latitude: null, longitude: null };
}

/** Attribute Sequelize yang dipakai pada klausa filter. */
const ACTIVE_ATTRIBUTE = 'STS_AKTIF';
const CODE_ATTRIBUTE = 'KD_UNIT';

/**
 * Repository master UPT (`hc.tb_r_upt`).
 *
 * Tabel ini kecil (±40–50 baris) dan relatif statis sehingga selalu dibaca
 * penuh; cache TTL diurus oleh `UptMasterService`, bukan di sini.
 */
class UptMasterRepository {
  /**
   * Kriteria master UPT yang sah dipakai seluruh fitur:
   * unit aktif, bukan data uji/dummy.
   *
   * @returns {object} Objek `where` untuk Sequelize.
   */
  static activeWhere() {
    return {
      [ACTIVE_ATTRIBUTE]: 1,
      [CODE_ATTRIBUTE]: { [Op.notIn]: TEST_UPT_CODES },
    };
  }

  /**
   * Mengambil seluruh baris master UPT yang aktif.
   *
   * @returns {Promise<object[]>} Baris mentah `tb_r_upt`.
   */
  static async findAllActive() {
    const rows = await TbRUpt.findAll({
      attributes: SELECTED_COLUMNS,
      where: UptMasterRepository.activeWhere(),
      order: [[CODE_ATTRIBUTE, 'ASC']],
      raw: true,
    });

    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Normalisasi satu baris master menjadi bentuk baku.
   *
   * Kode dibersihkan dari spasi/CRLF, label dipilih berurutan dari nama resmi
   * terbaru, dan baris tanpa kode maupun tanpa nama yang dapat ditampilkan
   * dibuang.
   *
   * @param {object} row Baris mentah `tb_r_upt`.
   * @returns {{ kdUnit: string, label: string, kota: string, nmUnit: string, alamat: string, latitude: number|null, longitude: number|null, raw: object }|null}
   */
  static normalizeRow(row) {
    const kdUnit = sanitizeLabel(row?.[CODE_ATTRIBUTE]);
    if (kdUnit === '' || isTestUptCode(kdUnit)) {
      return null;
    }

    const label =
      sanitizeLabel(row?.NM_PENDEK_BARU) ||
      sanitizeLabel(row?.NM_UNIT_BARU) ||
      sanitizeLabel(row?.NM_PENDEK) ||
      sanitizeLabel(row?.NM_UNIT) ||
      kdUnit;

    return {
      kdUnit,
      label,
      kota: sanitizeLabel(row?.KOTA),
      // `NM_UNIT` (nama panjang, mis. "Balai Karantina Ikan, ... Makassar")
      // disimpan terpisah dari `label` supaya popup peta bisa menampilkan nama
      // panjang sebagai alternatif. Sudah lewat `sanitizeLabel`, jadi CR/LF
      // bawaan tabel ini tidak ikut terbawa.
      nmUnit: sanitizeLabel(row?.NM_UNIT),
      // `ALAMAT_UNIT` juga mengandung CR/LF; `sanitizeLabel` merapikannya jadi
      // spasi tunggal agar aman ditampilkan di popup.
      alamat: sanitizeLabel(row?.ALAMAT_UNIT),
      // QUIRK kolom basis data: namanya TERTUKAR. `BUJUR` (harfiah
      // "longitude") justru menyimpan LATITUDE (mis. -5.06 untuk Makassar),
      // sedangkan `LINTANG` (harfiah "latitude") menyimpan LONGITUDE
      // (mis. 119.52). Pemetaan ke nama yang benar dilakukan di sini supaya
      // lapisan atas (service/controller/frontend) tidak perlu tahu
      // kekeliruan ini. `resolveCoordinates` sekaligus menangani baris yang
      // pasangannya benar-benar terbalik (mis. KD_UNIT 25.0).
      ...resolveCoordinates(row?.BUJUR, row?.LINTANG),
      raw: row,
    };
  }
}

export default UptMasterRepository;
