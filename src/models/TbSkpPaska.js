import { DataTypes } from 'sequelize';

/**
 * Model `tb_skp_paska` pada database `report_skp` (Sertifikasi Kelayakan
 * Pengolahan - Pasca Panen).
 *
 * Didefinisikan agar query agregasi dashboard memakai Model Sequelize
 * (Model-First Standard) alih-alih string tabel manual. Terikat ke instance
 * `dbReportSkp` dari `src/config/database.js` — JANGAN pernah menggabungkan
 * tabel ini dengan skema `hc` atau `report_siapmutu` (aturan tanpa JOIN
 * lintas-koneksi).
 *
 * CATATAN `id`: di database kolom ini berstatus PRI tetapi TANPA
 * `AUTO_INCREMENT` (dicek langsung ke `information_schema`). `autoIncrement:
 * true` dipertahankan sesuai keputusan/spesifikasi tim karena model ini hanya
 * dipakai untuk baca dan agregasi. Bila suatu saat ada operasi INSERT, `id`
 * wajib diisi manual karena DB tidak menghasilkannya otomatis.
 *
 * @param {import('sequelize').Sequelize} sequelize Koneksi `report_skp`.
 * @returns {import('sequelize').Model} Model `TbSkpPaska`.
 */
export default function initTbSkpPaska(sequelize) {
  const TbSkpPaska = sequelize.define(
    'TbSkpPaska',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      nama_upi: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      nib: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      provinsi_id: {
        type: DataTypes.STRING(2),
        allowNull: true,
      },
      provinsi: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      regency_id: {
        type: DataTypes.STRING(4),
        allowNull: true,
      },
      kota_kabupaten: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      alamat: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      skala_usaha: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      jenis_permohonan: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      tanggal_pengajuan: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tanggal_rekomendasi: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Kolom DATE murni di DB: memakai DATEONLY agar hasil agregasi berupa
      // string 'YYYY-MM-DD' tanpa pergeseran timezone ( DATETIME tetap DATE ).
      tanggal_terbit: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      tanggal_kadaluarsa: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      nomor_skp: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      nama_produk: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      jenis_olahan: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      peringkat: {
        type: DataTypes.STRING(1),
        allowNull: true,
      },
    },
    {
      tableName: 'tb_skp_paska',
      timestamps: false,
      freezeTableName: true,
    }
  );

  return TbSkpPaska;
}
