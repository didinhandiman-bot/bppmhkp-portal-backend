import { DataTypes } from 'sequelize';

/**
 * Model master role pengguna (`tb_role`) pada database `hc`.
 *
 * `role_user` adalah label role yang dikirim ke frontend (misalnya
 * "Administrator", "Admin UPT"). Relasi ke `tb_user` diselesaikan melalui
 * asosiasi `TbUser.belongsTo(TbRole)` di `src/models/index.js`.
 *
 * @param {import('sequelize').Sequelize} sequelize Koneksi database `hc`.
 * @returns {import('sequelize').Model} Model `TbRole`.
 */
export default function initTbRole(sequelize) {
  const TbRole = sequelize.define(
    'TbRole',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
        field: 'id',
      },
      role_user: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'role_user',
      },
    },
    {
      tableName: 'tb_role',
      schema: 'hc',
      timestamps: false,
      freezeTableName: true,
    }
  );

  return TbRole;
}
