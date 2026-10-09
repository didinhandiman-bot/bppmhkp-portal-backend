/**
 * Middleware otorisasi berbasis role.
 *
 * `verifyToken` di `authMiddleware.js` hanya memastikan token valid; siapa pun
 * pemegang token yang sah bisa melewati lapisan itu. Modul SKP hanya untuk
 * Administrator dan Admin UPT, jadi butuh lapisan kedua di sini.
 *
 * Catatan: login di `authService` juga sudah menolak role di luar 1 dan 2 dengan
 * 403, sehingga request yang reaches ke sini dalam kondisi normal selalu lolos.
 * Guard ini adalah pertahanan lapis kedua (defense in depth) untuk token lama
 * yang terbit sebelum aturan tersebut berlaku, atau bila suatu saat login
 * dilepas dari aturan role.
 */

/**
 * Membuat middleware yang hanya mengizinkan role tertentu.
 *
 * Claim role dibaca dari `roleId` dengan fallback ke `role_id`. Keduanya ada di
 * payload JWT: `roleId` dipakai frontend versi awal, `role_id` mengikuti
 * konvensi snake_case tabel.
 *
 * @param {number[]} allowedRoles Daftar role yang diizinkan, misal `[1, 2]`.
 * @returns {Function} Middleware Express.
 */
export const allowRoles = (allowedRoles = []) => (req, res, next) => {
  // Tanpa token yang sudah diverifikasi, `req.user` tidak ada. `verifyToken`
  // harus dipasang lebih dulu pada route yang sama.
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Token otentikasi tidak ditemukan',
      error: null,
    });
  }

  const rawRole = req.user.roleId ?? req.user.role_id;
  const roleId = Number(rawRole);
  const allowed = allowedRoles.map(Number);

  if (!allowed.includes(roleId)) {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak. Aplikasi ini hanya dapat diakses oleh Administrator/Executive (Role 1 & 2).',
      error: null,
    });
  }

  return next();
};
