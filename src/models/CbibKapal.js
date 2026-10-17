import { DataTypes } from 'sequelize';

export default function init(sequelize) {
  const CbibKapal = sequelize.define(
    'CbibKapal',
    {
      id_cbib: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: true,
      },
      no_cbib: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      nama_kapal: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      gt: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
      },
      tipe_kapal: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      tgl_permohonan: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tgl_spt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tgl_awal_inspeksi: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tgl_akhir_inspeksi: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tgl_laporan: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      jenis_produk: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      grade_scpib: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      tgl_terbit: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tgl_kadaluarsa: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      upt_inspeksi: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      kd_upt: {
            type: DataTypes.STRING(10),
            allowNull: true
      },
      nama_pelabuhan: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      kode_provinsi: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      nama_provinsi: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status_pemasok: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      nama_pemilik: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      jumlah_abk: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      alat_tangkap: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      daerah_tangkap: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      no_siup: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      no_kbli: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      pj_pusat: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
    },
    {
      tableName: 'tb_cbib_kapal',
      timestamps: false,
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    }
  );

  return CbibKapal;
}
