import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import authRepository from '../repositories/authRepository.js';
import { AppError } from '../errors/appError.js';

const ROLES_NASIONAL = [1, 6, 9];

/**
 * Role yang boleh masuk ke aplikasi ini.
 * 1 = Administrator, 2 = Admin UPT (Executive).
 * Role lain memang ada di `hc.tb_role` (Operator, Verifikator, User, dll.) tetapi
 * tidak berhak masuk ke dashboard BPPMHKP, sehingga login ditolak dengan 403
 * Forbidden — bukan 401, karena kredensialnya sendiri sudah benar.
 */
const ROLES_IZIN = [1, 2];

const PESAN_ROLE_DITOLAK =
  'Akses ditolak. Aplikasi ini hanya dapat diakses oleh Administrator/Executive (Role 1 & 2).';

class AuthService {
  async login(username, password, ipAddress) {
    const user = await authRepository.findByUsername(username);

    if (!user) {
      throw new Error('Kredensial tidak valid');
    }

    if (String(user.STATUS) !== '1') {
      throw new Error('Akun Anda tidak aktif. Silakan hubungi administrator.');
    }

    if (!user.PASSWORD) {
      throw new Error('Password belum dikonfigurasi untuk akun ini.');
    }

    const isMatch = await bcrypt.compare(password, user.PASSWORD);
    if (!isMatch) {
      throw new Error('Kredensial tidak valid');
    }

    // Gate role: dijalankan setelah password tervalidasi (kredensial benar) tetapi
    // SEBELUM `updateLoginSession`, supaya akun yang ditolak tidak ikut ter-update
    // LAST_LOGIN/DATE_LOGIN/IP_LOGIN.
    // `ROLE` di `hc.tb_user` bisa berupa string, kosong, atau NULL; nilai yang tidak
    // bisa dikonversi jadi NaN dan otomatis gugur dari ROLES_IZIN.
    const roleId = Number(user.ROLE_ID);

    if (!ROLES_IZIN.includes(roleId)) {
      throw new AppError(PESAN_ROLE_DITOLAK, 403);
    }

    await authRepository.updateLoginSession(user.USER_ID, ipAddress);

    const isNational = ROLES_NASIONAL.includes(roleId) || !user.KD_UNIT;

    const payload = {
      userId: user.USER_ID,
      username: user.USERNAME,
      nama: user.NAMA,
      roleId: roleId,
      // Alias snake_case ikut disertakan agar middleware/frontend mana pun yang
      // membaca `role_id` (konvensi tabel) tidak perlu mengubah.
      role_id: roleId,
      roleName: user.ROLE_NAME,
      kdUnit: isNational ? null : user.KD_UNIT,
      isNationalAccess: isNational,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET || 'bppmhkp_secret_key_executive_2026', {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    return {
      token,
      user: {
        id: user.USER_ID,
        username: user.USERNAME,
        nama: user.NAMA,
        jabatan: user.JABATAN,
        roleId: roleId,
        role_id: roleId,
        roleName: user.ROLE_NAME,
        kdUnit: user.KD_UNIT,
        isNationalAccess: isNational,
      },
    };
  }
}

export default new AuthService();
