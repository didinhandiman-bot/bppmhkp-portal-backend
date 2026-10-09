import { DataTypes } from 'sequelize';

/**
 * Model master UPT (`tb_r_upt`) pada database `hc`.
 *
 * Sengaja dipisah dari `ReportEksport` karena di production kedua tabel berada
 * pada server berbeda. Tidak ada `belongsTo`/`hasMany` lintas model: relasi
 * diselesaikan di level aplikasi lewat `UptMasterService` (lihat
 * `src/services/uptMasterService.js`).
 *
 * Kolom pada tabel master memakai huruf kapital, sedangkan pada
 * `tr_report_ekspor` huruf kecil. Nama atribut di sini mengikuti kapitalitas
 * tabel sumber agar query tetap eksplisit, dengan `field` yang mengunci
 * pemetaannya.
 *
 * @param {import('sequelize').Sequelize} sequelize Koneksi database `hc`.
 * @returns {import('sequelize').Model} Model `TbRUpt`.
 */
export default function initTbRUpt(sequelize) {
  const TbRUpt = sequelize.define(
    'TbRUpt',
    {
      KD_UNIT: {
        type: DataTypes.STRING(10),
        primaryKey: true,
        allowNull: false,
        field: 'KD_UNIT',
      },
      NM_UNIT: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'NM_UNIT',
      },
      ALAMAT_UNIT: {
        type: DataTypes.STRING(250),
        allowNull: true,
        field: 'ALAMAT_UNIT',
      },
      STS_AKTIF: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'STS_AKTIF',
      },
      NM_PENDEK: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'NM_PENDEK',
      },
      KD_PROP: {
        type: DataTypes.STRING(3),
        allowNull: true,
        field: 'KD_PROP',
      },
      KOTA: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'KOTA',
      },
      NM_UNIT_BARU: {
        type: DataTypes.STRING(150),
        allowNull: true,
        field: 'NM_UNIT_BARU',
      },
      NM_PENDEK_BARU: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'NM_PENDEK_BARU',
      },
    },
    {
      tableName: 'tb_r_upt',
      timestamps: false,
      // Nama model sudah mengikuti gaya tabel master; matikan pluralisasi agar
      // tidak ada Tabel `TbRUpts` yang tidak pernah dipakai.
      freezeTableName: true,
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    }
  );

  return TbRUpt;
}
