import { DataTypes } from 'sequelize';

export default function init(sequelize) {
  const ReportEksport = sequelize.define(
    'ReportEksport',
    {
      nomor_aju: {
        type: DataTypes.STRING(50),
        primaryKey: true,
      },
      kode_upt: {
        type: DataTypes.STRING(7),
        allowNull: false,
      },
      nama_upt: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      kode_trader: {
        type: DataTypes.STRING(15),
        allowNull: false,
      },
      nama_trader: {
        type: DataTypes.STRING(145),
        allowNull: false,
      },
      alamat_trader: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      npwp: {
        type: DataTypes.STRING(25),
        allowNull: false,
      },
      nama_upi: {
        type: DataTypes.STRING(145),
        allowNull: false,
      },
      no_reg_upi: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
      },
      alamat_upi: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      kode_partner: {
        type: DataTypes.STRING(15),
        allowNull: false,
      },
      nama_partner: {
        type: DataTypes.STRING(145),
        allowNull: false,
      },
      alamat_partner: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      tanggal_aju: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      tanggal_smkhp: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      tanggal_berangkat: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      bulan: {
        type: DataTypes.STRING(15),
        allowNull: false,
      },
      tahun: {
        type: DataTypes.STRING(5),
        allowNull: false,
      },
      konsumsi: {
        type: DataTypes.STRING(2),
        allowNull: false,
      },
      tawar_laut: {
        type: DataTypes.STRING(2),
        allowNull: false,
      },
      ket_bentuk: {
        type: DataTypes.STRING(45),
        allowNull: false,
      },
      kode_pel_asal: {
        type: DataTypes.STRING(5),
        allowNull: true,
        defaultValue: null,
      },
      pel_asal: {
        type: DataTypes.STRING(105),
        allowNull: false,
      },
      kode_pel_muat: {
        type: DataTypes.STRING(5),
        allowNull: true,
        defaultValue: null,
      },
      pel_muat: {
        type: DataTypes.STRING(105),
        allowNull: false,
      },
      kode_negara_partner: {
        type: DataTypes.STRING(3),
        allowNull: true,
        defaultValue: null,
      },
      negara_tujuan: {
        type: DataTypes.STRING(55),
        allowNull: false,
      },
      kode_pel_bongkar: {
        type: DataTypes.STRING(5),
        allowNull: true,
        defaultValue: null,
      },
      pel_bongkar: {
        type: DataTypes.STRING(105),
        allowNull: false,
      },
      hscode: {
        type: DataTypes.STRING(12),
        allowNull: true,
        defaultValue: null,
      },
      kel_ikan: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
      },
      id_ikan: {
        type: DataTypes.STRING(45),
        primaryKey: true,
        allowNull: false,
      },
      nm_dagang: {
        type: DataTypes.STRING(215),
        allowNull: true,
        defaultValue: null,
      },
      nm_latin: {
        type: DataTypes.STRING(185),
        allowNull: true,
        defaultValue: null,
      },
      netto: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: null,
      },
      jumlah: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: null,
      },
      nilai_per_satuan: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: null,
      },
      satuan: {
        type: DataTypes.STRING(15),
        allowNull: true,
        defaultValue: null,
      },
      nilai_rupiah: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: null,
      },
      kurs_usd: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: null,
      },
      no_hc: {
        type: DataTypes.STRING(45),
        allowNull: true,
        defaultValue: null,
      },
      cara_angkut: {
        type: DataTypes.STRING(45),
        allowNull: true,
        defaultValue: null,
      },
      alat_angkut: {
        type: DataTypes.STRING(45),
        allowNull: true,
        defaultValue: null,
      },
      voyage: {
        type: DataTypes.STRING(45),
        allowNull: true,
        defaultValue: null,
      },
      sumber_produk: {
        type: DataTypes.STRING(2),
        allowNull: true,
        defaultValue: null,
      },
      propinsi_sumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
      },
      kota_sumber: {
        type: DataTypes.STRING(150),
        allowNull: true,
        defaultValue: null,
      },
      area_tangkap: {
        type: DataTypes.STRING(55),
        allowNull: true,
        defaultValue: null,
      },
      nama_pembudidaya: {
        type: DataTypes.STRING(250),
        allowNull: true,
        defaultValue: null,
      },
      kapal_pengolah: {
        type: DataTypes.STRING(250),
        allowNull: true,
        defaultValue: null,
      },
      status: {
        type: DataTypes.STRING(3),
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      tableName: 'tr_report_ekspor',
      timestamps: false,
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    }
  );

  return ReportEksport;
}
