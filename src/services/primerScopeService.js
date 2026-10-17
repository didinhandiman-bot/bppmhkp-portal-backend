import CityUptService from './cityUptService.js';
import { scopedUptQuery } from '../utils/uptScope.js';
import { AppError } from '../errors/appError.js';

export default class PrimerScopeService {
  static async getQuery(user, raw = {}) {
    const query = scopedUptQuery(user, raw);
    delete query.provinceScope;
    delete query.cityScope;
    const code = user.isNationalAccess === false ? user.kdUnit :
      (query.uptId || query.kd_unit || query.kd_upt || query.kdUnit || query.kode_upt || query.upt_kode);
    if (!code) return query;
    const mappings = await CityUptService.getMappings();
    const cities = [...mappings].filter(([, unit]) => unit === String(code).trim()).map(([city]) => city);
    if (!cities.length) throw new AppError('Akses ditolak: pemetaan kota UPT tidak tersedia', 403);
    query.uptId = String(code).trim();
    query.cityScope = cities;

    // Catatan: untuk CPIB Kapal (kd_izin = 032000000033), filter UPT sekarang didukung
    // melalui kolom `kode_upt` pada `tb_cbib_kapal` yang dipetakan ke `KD_UNIT` master.
    // Tidak lagi dilempar error di sini — filter diteruskan ke repository.

    return query;
  }
}
