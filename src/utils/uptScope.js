import { AppError } from '../errors/appError.js';

const UPT_KEYS = ['kd_upt', 'kode_upt', 'upt_kode', 'upt', 'uptId', 'kd_unit', 'kdUnit', 'id_upt', 'idUpt'];

/** Klaim token menjadi sumber otorisasi; query tidak boleh memperluas akses. */
export function scopedUptQuery(user, query = {}) {
  if (!user) throw new AppError('Token otentikasi tidak ditemukan', 401);
  if (user.isNationalAccess === true) {
    const national = { ...query };
    delete national._uptRestricted;
    return national;
  }
  if (user.isNationalAccess !== false || typeof user.kdUnit !== 'string' || !user.kdUnit.trim()) {
    throw new AppError('Klaim akses UPT tidak valid', 403);
  }
  const scoped = { ...query };
  for (const key of UPT_KEYS) delete scoped[key];
  const code = user.kdUnit.trim();
  // Nama parameter mengikuti kontrak modul masing-masing, bukan mutasi req.query.
  Object.assign(scoped, { kd_upt: code, kd_unit: code, uptId: code, kdUnit: code, _uptRestricted: true });
  return scoped;
}

