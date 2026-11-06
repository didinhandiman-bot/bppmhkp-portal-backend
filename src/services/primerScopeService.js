import CityUptService from './cityUptService.js';
import { scopedUptQuery } from '../utils/uptScope.js';
import { AppError } from '../errors/appError.js';
import { KODE_IZIN_PRIMER } from '../repositories/primerRepository.js';

/**
 * Kode izin sertifikat CPIB Kapal.
 *
 * Sumber datanya `report_kapal.tb_cbib_kapal`, bukan
 * `report_primer.tr_laporan_primer_export`. Sampai pemetaan `upt_inspeksi`
 * dipercaya, baris kapal tidak bisa dihubungkan ke kota/UPT secara andal,
 * jadi modul ini hanya menyajikannya kepada akun nasional (lihat
 * `AGENTS.md`: "Scoped Primer/dashboard exclude kapal").
 */
const KD_IZIN_KAPAL = '032000000033';

export default class PrimerScopeService {
  static async getQuery(user, raw = {}) {
    const query = scopedUptQuery(user, raw);
    this.#assertIzinAllowed(user, query);
    delete query.provinceScope;
    delete query.cityScope;
    const code = user.isNationalAccess === false ? user.kdUnit :
      (query.uptId || query.kd_unit || query.kd_upt || query.kdUnit || query.kode_upt || query.upt_kode);
    if (!code) return query;
    const mappings = await CityUptService.getMappings();
    const cities = [...mappings].filter(([, unit]) => unit === String(code).trim()).map(([city]) => city);
    if (!cities.length) throw new AppError('Akses ditolak: pemetaan kota UPT tidak tersedia', 403);
    query.uptId = String(code).trim();
    query.cityScope = cities;

    // Catatan: untuk CPIB Kapal (kd_izin = 032000000033), filter UPT nasional
    // didukung melalui kolom `kode_upt` pada `tb_cbib_kapal` yang dipetakan ke
    // `KD_UNIT` master, jadi diteruskan ke repository. Untuk akun non-nasional
    // permintaan kapal sudah ditolak lebih awal oleh #assertIzinAllowed.

    return query;
  }

  /**
   * Tolak `kdIzin` yang tidak berada di dalam hak akses request.
   *
   * Dua aturan, keduanya berakhir sebagai `AppError` 403 supaya penolakan terlihat
   * oleh klien, bukan diam-diam menjadi daftar kosong:
   *
   * 1. Kode izin wajib ada di `KODE_IZIN_PRIMER` (whitelist yang sama dengan
   *    yang dipakai repository untuk filter default).
   * 2. `032000000033` (CPIB Kapal) hanya untuk akun nasional, karena datanya
   *    berasal dari `tb_cbib_kapal` dan belum bisa dipetakan per-UPT dengan
   *    aman untuk hasil terskope.
   *
   * Pemeriksaan sengaja ada di lapisan scope (bukan repository) supaya berlaku
   * untuk overview, tabel, maupun ekspor CSV — ketiganya melewati `getQuery`.
   *
   * @param {object} user - klaim dari `verifyToken`
   * @param {object} query - query yang sudah lewat `scopedUptQuery`
   * @throws {AppError} 403 bila kode izin tidak diizinkan
   */
  static #assertIzinAllowed(user, query) {
    const raw = query.kdIzin;
    if (raw === undefined || raw === null) return;

    // `String()` pada array hasil query ganda (`?kdIzin=a&kdIzin=b`) menghasilkan
    // "a,b" yang tidak pernah lolos whitelist, jadi duplikasi param ikut ditolak.
    const kdIzin = String(raw).trim();
    if (!kdIzin) return;

    if (!KODE_IZIN_PRIMER.includes(kdIzin)) {
      throw new AppError('Jenis izin tidak diizinkan', 403);
    }

    if (kdIzin === KD_IZIN_KAPAL && user.isNationalAccess !== true) {
      throw new AppError('Akses ditolak: data CPIB Kapal hanya tersedia bagi akses nasional', 403);
    }
  }
}
