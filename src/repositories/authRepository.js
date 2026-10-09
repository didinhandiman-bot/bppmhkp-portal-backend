import { QueryTypes } from 'sequelize';
import { dbMaster } from '../config/database.js';

class AuthRepository {
  async findByUsername(username) {
    const query = `
      SELECT 
        u.USER_ID,
        u.ROLE AS ROLE_ID,
        r.role_user AS ROLE_NAME,
        u.KODE_TRADER,
        u.USERNAME,
        u.PASSWORD,
        u.NAMA,
        u.EMAIL,
        u.JABATAN,
        u.KD_UNIT,
        u.STATUS
      FROM hc.tb_user u
      LEFT JOIN hc.tb_role r ON CAST(u.ROLE AS UNSIGNED) = r.id
      WHERE u.USERNAME = :username
      LIMIT 1
    `;
    const [user] = await dbMaster.query(query, {
      replacements: { username },
      type: QueryTypes.SELECT,
    });
    return user;
  }

  async updateLoginSession(userId, ipAddress) {
    const query = `
      UPDATE hc.tb_user
      SET 
        LAST_LOGIN = DATE_LOGIN,
        DATE_LOGIN = NOW(),
        IP_LOGIN = :ipAddress,
        STS_LOGIN = '1'
      WHERE USER_ID = :userId
    `;
    await dbMaster.query(query, {
      replacements: { userId, ipAddress: ipAddress || '127.0.0.1' },
    });
  }
}

export default new AuthRepository();
