import { DataTypes } from 'sequelize';

/**
 * Model pengguna aplikasi (`tb_user`) pada database `hc`.
 *
 * Tabel ini menyimpan kredensial login (password sudah di-hash), role, dan
 * unit kerja pengguna. `ROLE` bertipe varchar dan dipetakan ke `tb_role.id`
 * lewat asosiasi `TbUser.belongsTo(TbRole)` yang didaftarkan di
 * `src/models/index.js`.
 *
 * Seluruh nama atribut mengikuti kapitalitas tabel sumber dengan `field`
 * yang mengunci pemetaannya agar query tetap eksplisit.
 *
 * @param {import('sequelize').Sequelize} sequelize Koneksi database `hc`.
 * @returns {import('sequelize').Model} Model `TbUser`.
 */
export default function initTbUser(sequelize) {
  const TbUser = sequelize.define(
    'TbUser',
    {
      USER_ID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
        field: 'USER_ID',
      },
      ROLE: {
        type: DataTypes.STRING(2),
        allowNull: false,
        field: 'ROLE',
      },
      KODE_TRADER: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'KODE_TRADER',
      },
      USERNAME: {
        type: DataTypes.STRING(70),
        allowNull: false,
        field: 'USERNAME',
      },
      PASSWORD: {
        type: DataTypes.STRING(70),
        allowNull: true,
        field: 'PASSWORD',
      },
      JNS_ID: {
        type: DataTypes.STRING(1),
        allowNull: true,
        field: 'JNS_ID',
      },
      NO_ID: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'NO_ID',
      },
      NAMA: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'NAMA',
      },
      ALAMAT: {
        type: DataTypes.STRING(170),
        allowNull: false,
        field: 'ALAMAT',
      },
      EMAIL: {
        type: DataTypes.STRING(70),
        allowNull: true,
        field: 'EMAIL',
      },
      TELEPON: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'TELEPON',
      },
      JABATAN: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'JABATAN',
      },
      KD_UNIT: {
        type: DataTypes.STRING(7),
        allowNull: true,
        field: 'KD_UNIT',
      },
      STATUS: {
        type: DataTypes.STRING(1),
        allowNull: false,
        field: 'STATUS',
      },
      STS_LOGIN: {
        type: DataTypes.STRING(1),
        allowNull: true,
        field: 'STS_LOGIN',
      },
      DATE_LOGIN: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'DATE_LOGIN',
      },
      IP_LOGIN: {
        type: DataTypes.STRING(30),
        allowNull: true,
        field: 'IP_LOGIN',
      },
      LAST_LOGIN: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'LAST_LOGIN',
      },
      DATE_CREATED: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'DATE_CREATED',
      },
      USER_CREATED: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'USER_CREATED',
      },
      LAST_UPDATED: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'LAST_UPDATED',
      },
      USER_UPDATED: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'USER_UPDATED',
      },
      FILE_ID: {
        type: DataTypes.STRING(45),
        allowNull: true,
        field: 'FILE_ID',
      },
    },
    {
      tableName: 'tb_user',
      schema: 'hc',
      timestamps: false,
      freezeTableName: true,
    }
  );

  return TbUser;
}
