import { DataTypes } from 'sequelize';

/**
 * Model `tb_spdi_pasca` pada database `report_spdi` (SPDI - Pascapanen).
 *
 * Terikat ke instance `dbReportSpdi` dari `src/config/database.js` — JANGAN
 * pernah menggabungkan tabel ini dengan skema `hc`, `report_siapmutu`, atau
 * skema report lain (aturan tanpa JOIN lintas-koneksi).
 *
 * Penyimpangan dari konvensi model lain di repo ini (atas permintaan
 * spesifikasi modul SPDI):
 *
 * - Lokasi file di subfolder `models/report_spdi/` karena skema ini punya
 *   namespace sendiri.
 * - `timestamps: true` karena tabel memang memiliki `created_at`/`updated_at`
 *   (kolomnya bernilai nyata, bukan hasil `NOW()` default), dengan `createdAt`
 *   dan `updatedAt` dipetakan ke nama kolom snake_case tersebut.
 *
 * Kolom tanggal (`tgl_permohonan`, `tgl_terbit`) berstype DATE murni di DB,
 * jadi memakai `DATEONLY` agar hasil query berupa string 'YYYY-MM-DD' tanpa
 * pergeseran timezone (`tgl_terbit` nullable: sebagian permohonan belum
 * terbit).
 *
 * CATATAN: spesifikasi kolom menyebut `kab_kot`, hasil `SHOW COLUMNS`
 * menyatakan nama aslinya `kab_kota`. Model mengikuti database; ada pula
 * kolom `provinsi` yang tidak ada di spesifikasi tetapi dipakai sebagai
 * label bantu.
 *
 * @param {import('sequelize').Sequelize} sequelize Koneksi `report_spdi`.
 * @returns {import('sequelize').ModelStatic<import('sequelize').Model>} Model `TbSpdiPasca`.
 */
export default function initTbSpdiPasca(sequelize) {
  const TbSpdiPasca = sequelize.define(
    'TbSpdiPasca',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      nama_unit: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      tgl_permohonan: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      tgl_terbit: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      nomor_sertifikat: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      kd_upt: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      nama_upt: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      kd_provinsi: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      provinsi: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      kab_kota: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      skor_inspeksi: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
      },
      skor_cdib: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
      },
      tagging_kdmp: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      kbli: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      produk: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'tb_spdi_pasca',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      freezeTableName: true,
    }
  );

  return TbSpdiPasca;
}
