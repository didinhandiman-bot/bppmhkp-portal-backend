import { DataTypes } from 'sequelize';

/**
 * Model master kota/kabupaten (`tb_kota`) pada database `hc`.
 *
 * Tabel ini menjadi penghubung antara kota Primer dan UPT melalui kolom
 * `KODE_UPT`, yang dipetakan ke `tb_r_upt.KD_UNIT`. Karena kedua tabel berada
 * pada koneksi `dbMaster` yang sama, relasinya masih bisa diselesaikan di
 * dalam satu database; tidak ada JOIN lintas-skema.
 *
 * Nama atribut mengikuti kapitalitas tabel sumber dan `field` mengunci
 * pemetaannya agar query tetap eksplisit.
 *
 * @param {import('sequelize').Sequelize} sequelize Koneksi database `hc`.
 * @returns {import('sequelize').Model} Model `TbKota`.
 */
export default function initTbKota(sequelize) {
  const TbKota = sequelize.define(
    'TbKota',
    {
      KODE_KOTA: {
        type: DataTypes.STRING(4),
        primaryKey: true,
        allowNull: false,
        field: 'KODE_KOTA',
      },
      KODE_PROPINSI: {
        type: DataTypes.STRING(2),
        allowNull: false,
        field: 'KODE_PROPINSI',
      },
      URAIAN_KOTA: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'URAIAN_KOTA',
      },
      KODE_UPT: {
        type: DataTypes.STRING(8),
        allowNull: true,
        field: 'KODE_UPT',
      },
    },
    {
      tableName: 'tb_kota',
      schema: 'hc',
      timestamps: false,
      freezeTableName: true,
    }
  );

  return TbKota;
}
