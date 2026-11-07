import { TbUser, TbRole, dbMaster } from '../models/index.js';

class AuthRepository {
  async findByUsername(username) {
    const user = await TbUser.findOne({
      attributes: [
        'USER_ID',
        'ROLE',
        'KODE_TRADER',
        'USERNAME',
        'PASSWORD',
        'NAMA',
        'EMAIL',
        'JABATAN',
        'KD_UNIT',
        'STATUS',
      ],
      include: [
        {
          model: TbRole,
          as: 'role',
          attributes: ['role_user'],
          required: false,
        },
      ],
      where: { USERNAME: username },
      limit: 1,
    });

    if (!user) {
      return undefined;
    }

    const plain = user.get({ plain: true });

    return {
      USER_ID: plain.USER_ID,
      ROLE_ID: plain.ROLE,
      ROLE_NAME: plain.role ? plain.role.role_user : null,
      KODE_TRADER: plain.KODE_TRADER,
      USERNAME: plain.USERNAME,
      PASSWORD: plain.PASSWORD,
      NAMA: plain.NAMA,
      EMAIL: plain.EMAIL,
      JABATAN: plain.JABATAN,
      KD_UNIT: plain.KD_UNIT,
      STATUS: plain.STATUS,
    };
  }

  async updateLoginSession(userId, ipAddress) {
    await TbUser.update(
      {
        LAST_LOGIN: dbMaster.literal('DATE_LOGIN'),
        DATE_LOGIN: dbMaster.literal('NOW()'),
        IP_LOGIN: ipAddress || '127.0.0.1',
        STS_LOGIN: '1',
      },
      {
        where: { USER_ID: userId },
      }
    );
  }
}

export default new AuthRepository();
