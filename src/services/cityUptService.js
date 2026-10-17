import CityUptRepository from '../repositories/cityUptRepository.js';
import { AppError } from '../errors/appError.js';

export default class CityUptService {
  static async getMappings() {
    const rows = await CityUptRepository.findMappings();
    const mappings = new Map();
    for (const row of rows) {
      const city = String(row.KODE_KOTA ?? '').trim();
      const unit = String(row.KODE_UPT ?? '').trim();
      if (!/^\d{4}$/.test(city) || !unit) continue;
      if (mappings.has(city) && mappings.get(city) !== unit) {
        throw new AppError('Pemetaan kota ke UPT ambigu', 503);
      }
      mappings.set(city, unit);
    }
    return mappings;
  }
}
