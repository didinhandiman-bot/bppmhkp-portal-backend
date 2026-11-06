import { DataTypes } from 'sequelize';

/**
 * Model `tr_laporan_primer_export` pada database `report_primer` (laporan
 * perizinan primer / sertifikat hasil inspeksi).
 *
 * PK yang dipakai adalah `id_export` — kolom PRI `AUTO_INCREMENT` asli dari
 * tabel (dicek langsung ke `information_schema`). `no_izin` TIDAK dijadikan
 * primaryKey karena datanya tidak unik (953 nilai berbeda dari 1017 baris),
 * sehingga `findByPk` pada kolom itu akan mengembalikan baris sembarang.
 *
 * CATATAN TABEL (lihat AGENTS.md — Primer Data Quirks):
 * - `total_hasil`, `total_minor`, `total_mayor`, `total_kritis` bertipe
 *   VARCHAR, bukan angka. `total_hasil` berisi label kategorikal (`Cukup`,
 *   `Baik`, `Sangat Baik`, `P1`/`P2`/`P3`, `LULUS`, `-`), jadi GROUP BY,
 *   jangan SUM. Rata-rata temuan wajib `CAST(... AS DECIMAL)` agar MySQL
 *   tidak menghitung rata-rata string.
 * - Nama kolom perusahaan adalah `nama_perseroan` (tidak ada
 *   `nama_perusahaan`).
 *
 * Terikat ke instance `dbPrimer`. Skema `mutu` sengaja tidak di-JOIN dari
 * sini (aturan tanpa JOIN lintas-koneksi).
 *
 * @param {import('sequelize').Sequelize} sequelize Koneksi `report_primer`.
 * @returns {import('sequelize').Model} Model `TrLaporanPrimerExport`.
 */
export default function initTrLaporanPrimerExport(sequelize) {
  const TrLaporanPrimerExport = sequelize.define(
    'TrLaporanPrimerExport',
    {
      id_export: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      idchecklist: {
        type: DataTypes.STRING(25),
        allowNull: true,
      },
      tgl_izin: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      id_izin: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      jenis_izin: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      kd_izin: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      ur_izin_singkat: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      kd_daerah: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      nama_izin: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      no_izin: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      nib: {
        type: DataTypes.STRING(13),
        allowNull: true,
      },
      tgl_permohonan: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      status_checklist: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      sts_aktif: {
        type: DataTypes.STRING(1),
        allowNull: true,
      },
      komoditas: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      no_referensi: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      uraian_propinsi: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      kbli: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      uraian_usaha: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      npwp_perseroan: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      nama_perseroan: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      alamat_perseroan: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      rt_rw_perseroan: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      kelurahan_perseroan: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      perseroan_daerah_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      kode_pos_perseroan: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      nomor_telpon_perseroan: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      email_perusahaan: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      // VARCHAR, bukan angka — lihat catatan Primer Data Quirks di atas.
      total_sesuai: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      total_minor: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      total_mayor: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      total_kritis: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      total_hasil: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      keterangan: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      tgl_tarik_data: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      sumber_data: {
        type: DataTypes.ENUM('SISTEM', 'MANUAL'),
        allowNull: true,
      },
    },
    {
      tableName: 'tr_laporan_primer_export',
      timestamps: false,
      freezeTableName: true,
    }
  );

  return TrLaporanPrimerExport;
}
