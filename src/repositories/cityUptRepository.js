import { QueryTypes } from 'sequelize';
import { dbMaster } from '../config/database.js';
import { TEST_UPT_CODES } from '../utils/uptCode.js';

export default class CityUptRepository {
  static findMappings() {
    // JOIN hanya di dalam hc; data Primer dibaca terpisah melalui dbPrimer.
    return dbMaster.query(
      `SELECT k.KODE_KOTA, k.KODE_UPT
       FROM hc.tb_kota k
       INNER JOIN hc.tb_r_upt u ON TRIM(k.KODE_UPT) = TRIM(u.KD_UNIT)
       WHERE u.STS_AKTIF = 1 AND u.KD_UNIT NOT IN (:testCodes)`,
      { replacements: { testCodes: TEST_UPT_CODES }, type: QueryTypes.SELECT },
    );
  }
}
