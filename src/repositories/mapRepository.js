import { literal } from 'sequelize';
import {
  TrLaporanPrimerExport,
  CbibKapal,
  TbSkpPaska,
  Vw07Sertifikasi,
} from '../models/index.js';

/**
 * Repository untuk endpoint peta sebaran penerbitan sertifikasi
 * (`GET /api/v1/landing/peta-sebar`).
 *
 * Tanggung jawab file ini HANYA membaca database dan mengembalikan baris
 * mentah hasil agregasi per provinsi. Tidak ada perhitungan bisnis di sini:
 * pemetaan kode provinsi, penamaan field payload, dan penggabungan antar-
 * sumber seluruhnya dilakukan di service (`mapService.js`).
 *
 * SELURUH pembacaan dieksekusi lewat method Model Sequelize
 * (`Model.findAll`) dengan agregasi `sequelize.literal()` (Model-First
 * Standard). Tidak ada lagi `db.query(...)` / `QueryTypes.SELECT` maupun
 * string nama tabel manual — model yang dipakai adalah `TrLaporanPrimerExport`,
 * `CbibKapal`, `TbSkpPaska`, dan `Vw07Sertifikasi` dari `../models/index.js`.
 *
 * ATURAN DUAL-DATABASE: setiap query hanya menyentuh SATU schema. Tidak ada
 * JOIN lintas-database (mis. `report_primer` dengan `report_kapal`) — data
 * digabung in-memory di service. Karena itu keempat method di bawah menerima
 * rentang tanggal yang sama dan dipanggil paralel, bukan digabung di SQL.
 *
 * Kolom tanggal bersumber dari kolom `DATE` (`tgl_izin`, `tgl_terbit`,
 * `tanggal_terbit`), sehingga `BETWEEN :startDate AND :endDate` sudah
 * mencakup hari terakhir bila service mengirim batas atas jam `23:59:59`.
 * Nilai tanggal tetap masuk lewat `replacements`, bukan interpolasi string.
 *
 * Catatan nama kolom provinsi yang sudah diverifikasi langsung ke server:
 * - `tb_skp_paska`   : `provinsi_id` (VARCHAR(2), kode BPS) + `provinsi`.
 * - `tb_cbib_kapal`  : `kode_provinsi` (VARCHAR(2), kode BPS) + `nama_provinsi`.
 * - `tr_laporan_primer_export` : hanya `uraian_propinsi` (NAMA). Tidak ada
 *   `kode_provinsi`; `kd_daerah` tidak dapat dipakai (datanya kotor).
 * - `vw07_sertifikasi` : `nm_provinsi` (NAMA); `id_provinsi` adalah indeks
 *   surrogat, BUKAN kode BPS.
 */
class MapRepository {
  /**
   * Agregasi sertifikat primer per provinsi, dipecah per jenis izin.
   *
   * Mengembalikan baris mentah `{ provinsi, kd_izin, total }`. Pemetaan
   * `kd_izin` ke key payload (`cpib`, `cbib`, dst.) sengaja ditinggal di
   * service karena whitelist kode izin adalah keputusan bisnis, bukan urusan
   * SQL (lihat aturan "no business constants in repository SQL").
   *
   * Tabel `tr_laporan_primer_export` tidak punya kolom kode provinsi, jadi
   * GROUP BY memakai `uraian_propinsi`; service yang mengonversinya ke kode
   * BPS melalui `utils/provinceCode.js`.
   *
   * @param {string} startDate Awal rentang, mis. `2026-01-01 00:00:00`.
   * @param {string} endDate Akhir rentang, mis. `2026-12-31 23:59:59`.
   * @returns {Promise<Array<{provinsi: string, kd_izin: string, total: number}>>}
   */
  static async getPrimerByProvince(startDate, endDate) {
    const rows = await TrLaporanPrimerExport.findAll({
      attributes: [
        [literal('uraian_propinsi'), 'provinsi'],
        [literal('kd_izin'), 'kd_izin'],
        [literal('COUNT(*)'), 'total'],
      ],
      where: literal('tgl_izin BETWEEN :startDate AND :endDate'),
      group: [literal('uraian_propinsi'), literal('kd_izin')],
      replacements: { startDate, endDate },
      raw: true,
    });

    return rows.map((row) => ({
      provinsi: row.provinsi,
      kd_izin: row.kd_izin,
      total: Number(row.total) || 0,
    }));
  }

  /**
   * Agregasi sertifikat CPIB Kapal per provinsi.
   *
   * `tb_cbib_kapal.kode_provinsi` sudah berupa kode BPS 2 digit, jadi service
   * cukup menormalkannya (`String(kd).padStart(2, '0')`). Seluruh baris tabel
   * ini adalah sertifikat CPIB Kapal, sehingga tidak perlu filter `kd_izin`.
   *
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Array<{kode_provinsi: string, total: number}>>}
   */
  static async getKapalByProvince(startDate, endDate) {
    const rows = await CbibKapal.findAll({
      attributes: [
        [literal('kode_provinsi'), 'kode_provinsi'],
        [literal('COUNT(*)'), 'total'],
      ],
      where: literal('tgl_terbit BETWEEN :startDate AND :endDate'),
      group: [literal('kode_provinsi')],
      replacements: { startDate, endDate },
      raw: true,
    });

    return rows.map((row) => ({
      kode_provinsi: row.kode_provinsi,
      total: Number(row.total) || 0,
    }));
  }

  /**
   * Agregasi jumlah SKP per provinsi.
   *
   * `provinsi_id` pada `tb_skp_paska` sudah kode BPS 2 digit. Kolom
   * `provinsi` ikut dibawa sebagai cadangan bila suatu saat `provinsi_id`
   * kosong, supaya service masih bisa memetakan lewat nama.
   *
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Array<{provinsi_id: string, provinsi: string, total: number}>>}
   */
  static async getSkpByProvince(startDate, endDate) {
    const rows = await TbSkpPaska.findAll({
      attributes: [
        [literal('provinsi_id'), 'provinsi_id'],
        [literal('provinsi'), 'provinsi'],
        [literal('COUNT(*)'), 'total'],
      ],
      where: literal('tanggal_terbit BETWEEN :startDate AND :endDate'),
      group: [literal('provinsi_id'), literal('provinsi')],
      replacements: { startDate, endDate },
      raw: true,
    });

    return rows.map((row) => ({
      provinsi_id: row.provinsi_id,
      provinsi: row.provinsi,
      total: Number(row.total) || 0,
    }));
  }

  /**
   * Agregasi sertifikat HACCP per provinsi: jumlah per grade (A/B/C) dan
   * jumlah UPI unik.
   *
   * Pivot grade dikerjakan di SQL agar satu kali pemindaian view sudah
   * menghasilkan seluruh angka yang dibutuhkan payload. `COUNT(DISTINCT id_upi)`
   * dihitung pada level provinsi (bukan dijumlahkan dari per-grade) supaya UPI
   * yang punya beberapa grade tidak terhitung berlipat.
   *
   * `vw07_sertifikasi.id_provinsi` adalah indeks surrogat, sehingga service
   * memetakan provinsi lewat `nm_provinsi`. Kolom itu disertakan agar service
   * tidak perlu query kedua.
   *
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Array<{id_provinsi: number, nm_provinsi: string, gradeA: number, gradeB: number, gradeC: number, jumlahUpi: number}>>}
   */
  static async getHaccpByProvince(startDate, endDate) {
    const rows = await Vw07Sertifikasi.findAll({
      attributes: [
        [literal('id_provinsi'), 'id_provinsi'],
        [literal('nm_provinsi'), 'nm_provinsi'],
        [literal("SUM(CASE WHEN TRIM(UPPER(grade)) = 'A' THEN 1 ELSE 0 END)"), 'gradeA'],
        [literal("SUM(CASE WHEN TRIM(UPPER(grade)) = 'B' THEN 1 ELSE 0 END)"), 'gradeB'],
        [literal("SUM(CASE WHEN TRIM(UPPER(grade)) = 'C' THEN 1 ELSE 0 END)"), 'gradeC'],
        [literal('COUNT(DISTINCT id_upi)'), 'jumlahUpi'],
      ],
      where: literal('tgl_terbit BETWEEN :startDate AND :endDate'),
      group: [literal('id_provinsi'), literal('nm_provinsi')],
      replacements: { startDate, endDate },
      raw: true,
    });

    return rows.map((row) => ({
      id_provinsi: row.id_provinsi,
      nm_provinsi: row.nm_provinsi,
      gradeA: Number(row.gradeA) || 0,
      gradeB: Number(row.gradeB) || 0,
      gradeC: Number(row.gradeC) || 0,
      jumlahUpi: Number(row.jumlahUpi) || 0,
    }));
  }
}

export default MapRepository;
