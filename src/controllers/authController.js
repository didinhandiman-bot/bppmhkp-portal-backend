import authService from '../services/authService.js';

class AuthController {
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

      if (!username || !password) {
        return res.status(400).json({
          status: 'error',
          message: 'Username dan password wajib diisi',
        });
      }

      const result = await authService.login(username, password, ipAddress);

      return res.status(200).json({
        status: 'success',
        message: 'Login berhasil',
        data: result,
      });
    } catch (error) {
      // 403 = kredensial benar namun role tidak entitled ke aplikasi ini (lihat
      // ROLES_IZIN di authService). Envelope-nya `{ success, message }` sesuai
      // spesifikasi akses role; selebihnya error auth tetap memakai `{ status, message }`.
      if (error.statusCode === 403) {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(401).json({
        status: 'error',
        message: error.message,
      });
    }
  }

  async me(req, res) {
    return res.status(200).json({
      status: 'success',
      data: req.user,
    });
  }
}

export default new AuthController();
