import MapRepository from '../repositories/mapRepository.js';
import UptMasterService from './uptMasterService.js';
import {
  PROVINCE_NAME_BY_CODE,
  normalizeProvinceCode,
  provinceCodeFromName,
  provinceNameFromCode,
} from '../utils/provinceCode.js';

/**
 * Service peta sebaran penerbitan sertifikasi.
 *
 * Tugasnya menyatukan data dari empat schema menjadi satu payload per
 * provinsi. Penggabungan dilakukan IN-MEMORY lewat `Map` ber-key kode provinsi
 * 2 digit, bukan lewat JOIN lintas-database (yang dilarang oleh aturan
 * dual-database di proyek ini).
 *
 * Kunci payload sengaja disamakan dengan `properties.KODE_PROV` pada GeoJSON
 * `38-Provinsi-Indonesia.json` milik frontend, sehingga peta bisa memasangkan
 * nilai cukup dengan `kodeProvinsi`.
 *
 * Empat sumber data dan cara membaca provinsinya:
 * - Primer  : `uraian_propinsi` (nama)  -> `provinceCodeFromName`.
 * - Kapal   : `kode_provinsi` (BPS)     -> `normalizeProvinceCode`.
 * - SKP     : `provinsi_id` (BPS)       -> `normalizeProvinceCode`, fallback nama.
 * - HACCP   : `nm_provinsi` (nama)      -> `provinceCodeFromName`.
 */

/** Tahun terendah yang dianggap valid untuk parameter `tahun`. */
const MIN_YEAR = 2000;

/** Tahun tertinggi yang dianggap valid untuk parameter `tahun`. */
const MAX_YEAR = 2100;

/**
 * Pemetaan `kd_izin` pada `tr_laporan_primer_export` ke key payload.
 *
 * Kode di sini sudah diverifikasi terhadap data nyata lewat
 * `jenis_izin`/`ur_izin_singkat` (semuanya `K03`). Kode `032000000036`
 * berlabel CDOIB, sedangkan `032000000087` (yang disebut di modul primer lama)
 * tidak pernah muncul di tabel ini. `cpibKapal` TIDAK ada di tabel primer —
 * nilainya datang dari `tb_cbib_kapal`.
 */
const PRIMER_IZIN_KEYS = new Map([
  ['032000000034', 'cpib'],
  ['032000000068', 'cbib'],
  ['032000000014', 'cppib'],
  ['032000000019', 'cpoib'],
  ['032000000036', 'cdoib'],
]);

/**
 * Menentukan tahun efektif dari parameter query.
 *
 * Nilai yang bukan 4 digit atau di luar rentang wajar diabaikan dan diganti
 * tahun berjalan. Endpoint ini publik di landing page — lebih baik menampilkan
 * data tahun berjalan daripada membalas error karena parameter yang salah
 * ketik.
 *
 * @param {unknown} value Nilai mentah `req.query.tahun`.
 * @returns {number} Tahun efektif.
 */
function resolveYear(value) {
  const raw = String(Array.isArray(value) ? value[0] : value ?? '').trim();

  if (/^\d{4}$/.test(raw)) {
    const year = Number(raw);
    if (year >= MIN_YEAR && year <= MAX_YEAR) {
      return year;
    }
  }

  return new Date().getFullYear();
}

/**
 * Membuat satu entri provinsi dengan seluruh metrik bernilai nol.
 *
 * Seluruh 38 provinsi di-seed lebih dulu supaya peta selalu punya nilai untuk
 * setiap feature GeoJSON — provinsi tanpa data tampil sebagai 0, bukan hilang.
 *
 * @param {string} kodeProvinsi Kode BPS 2 digit.
 * @returns {object} Entri provinsi kosong.
 */
function createEmptyEntry(kodeProvinsi) {
  return {
    kodeProvinsi,
    namaProvinsi: provinceNameFromCode(kodeProvinsi),
    primer: {
      cpib: 0,
      cbib: 0,
      cppib: 0,
      cpoib: 0,
      cpibKapal: 0,
      cdoib: 0,
    },
    pascaPanen: {
      skp: 0,
      haccp: {
        gradeA: 0,
        gradeB: 0,
        gradeC: 0,
      },
      jumlahUpi: 0,
    },
  };
}

/**
 * Menyiapkan `Map` provinsi yang sudah terisi nol untuk 38 provinsi.
 *
 * Urutan iterasi `PROVINCE_NAME_BY_CODE` sudahurut kode, jadi hasil
 * `Map.values()` otomatis terurut tanpa perlu `sort` tambahan.
 *
 * @returns {Map<string, object>} Map kode provinsi -> entri.
 */
function buildProvinceMap() {
  const provinces = new Map();
  for (const code of PROVINCE_NAME_BY_CODE.keys()) {
    provinces.set(code, createEmptyEntry(code));
  }
  return provinces;
}

/**
 * Service peta sebaran.
 *
 * Method hanya berisi orkestrasi + penggabungan; seluruh akses database tetap
 * di `MapRepository`.
 */
class MapService {
  /**
   * Mengambil payload sebaran penerbitan sertifikasi per provinsi.
   *
   * Keempat sumber dibaca paralel (`Promise.all`) karena saling bebas dan
   * masing-masing `GROUP BY` provinsi, jadi wall-clock-nya satu putaran
   * query, bukan empat.
   *
   * @param {unknown} tahun Tahun laporan (opsional, default tahun berjalan).
   * @returns {Promise<Array<object>>} Array 38 provinsi siap dipetakan ke GeoJSON.
   */
  static async getPetaSebaran(tahun) {
    const year = resolveYear(tahun);
    const startDate = `${year}-01-01 00:00:00`;
    const endDate = `${year}-12-31 23:59:59`;

    const [primerRows, kapalRows, skpRows, haccpRows] = await Promise.all([
      MapRepository.getPrimerByProvince(startDate, endDate),
      MapRepository.getKapalByProvince(startDate, endDate),
      MapRepository.getSkpByProvince(startDate, endDate),
      MapRepository.getHaccpByProvince(startDate, endDate),
    ]);

    const provinces = buildProvinceMap();

    // Primer: agregasi per provinsi + jenis izin.
    for (const row of primerRows) {
      const code = provinceCodeFromName(row.provinsi);
      const entry = code ? provinces.get(code) : undefined;
      if (!entry) continue;

      const key = PRIMER_IZIN_KEYS.get(row.kd_izin);
      if (key) {
        entry.primer[key] += row.total;
      }
    }

    // Kapal: seluruh baris CPIB Kapal, masuk ke `primer.cpibKapal`.
    for (const row of kapalRows) {
      const code = normalizeProvinceCode(row.kode_provinsi);
      const entry = code ? provinces.get(code) : undefined;
      if (entry) {
        entry.primer.cpibKapal += row.total;
      }
    }

    // SKP: `provinsi_id` sudah kode BPS; nama dipakai sebagai cadangan.
    for (const row of skpRows) {
      const code =
        normalizeProvinceCode(row.provinsi_id) ?? provinceCodeFromName(row.provinsi);
      const entry = code ? provinces.get(code) : undefined;
      if (entry) {
        entry.pascaPanen.skp += row.total;
      }
    }

    // HACCP: `id_provinsi` surrogat, jadi provinsi dikenali dari nama.
    for (const row of haccpRows) {
      const code = provinceCodeFromName(row.nm_provinsi);
      const entry = code ? provinces.get(code) : undefined;
      if (!entry) continue;

      entry.pascaPanen.haccp.gradeA += row.gradeA;
      entry.pascaPanen.haccp.gradeB += row.gradeB;
      entry.pascaPanen.haccp.gradeC += row.gradeC;
      entry.pascaPanen.jumlahUpi += row.jumlahUpi;
    }

    return [...provinces.values()];
  }

  /**
   * Titik UPT untuk peta sebaran.
   *
   * Mendelegasikan ke `UptMasterService` (satu-satunya cache master UPT) agar
   * endpoint publik tidak membuka pembacaan master kedua. Koordinatnya sudah
   * dinormalkan di repository (kekeliruan kolom `BUJUR`/`LINTANG` ditangani di
   * sana), sehingga di sini cukup meneruskan.
   *
   * @returns {Promise<Array<object>>} Daftar marker `{ kodeUpt, nama, kota, latitude, longitude }`.
   */
  static async getUptMarkers() {
    return UptMasterService.getMapMarkers();
  }
}

export default MapService;
