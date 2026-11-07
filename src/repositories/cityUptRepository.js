import { literal } from 'sequelize';
import { TbKota, TbRUpt } from '../models/index.js';
import { TEST_UPT_CODES } from '../utils/uptCode.js';

/** Mengutip identifier agar aman dipakai di dalam `literal`. */
function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '')}\``;
}

/**
 * Repository pemetaan kota/kabupaten (`tb_kota`) ke UPT (`tb_r_upt`).
 *
 * Kedua tabel berada pada koneksi `hc` (`dbMaster`), sehingga relasinya masih
 * dapat diselesaikan dalam satu database. Pembacaan tetap dilakukan lewat
 * Model Sequelize (`TbKota.findAll`) — tidak ada `db.query`/`QueryTypes`
 * mentah. Nama tabel dan kolom diturunkan dari metadata model agar tidak ada
 * kamus nama tabel manual di lapisan repository.
 *
 * Klausa `where` berupa `literal` tanpa kata kunci `WHERE` (generator
 * Sequelize menambahkannya) dan seluruh nilai dinamis masuk lewat
 * `replacements`.
 */
export default class CityUptRepository {
  /**
   * Mengambil pasangan `KODE_KOTA` -> `KODE_UPT` untuk UPT aktif non-uji.
   *
   * Semantiknya identik dengan JOIN lama:
   * `TRIM(tb_kota.KODE_UPT) = TRIM(tb_r_upt.KD_UNIT)`
   * dengan `STS_AKTIF = 1` dan kode uji dikecualikan.
   *
   * @returns {Promise<Array<{KODE_KOTA: string, KODE_UPT: string}>>}
   */
  static findMappings() {
    const uptTable = TbRUpt.getTableName();
    const uptTableName = typeof uptTable === 'string' ? uptTable : uptTable.tableName;
    const uptCodeColumn = TbRUpt.rawAttributes.KD_UNIT.field;
    const uptActiveColumn = TbRUpt.rawAttributes.STS_AKTIF.field;
    const cityUptColumn = TbKota.rawAttributes.KODE_UPT.field;

    const condition = [
      `TRIM(${quoteIdentifier(cityUptColumn)}) IN (`,
      `SELECT TRIM(${quoteIdentifier(uptCodeColumn)})`,
      `FROM ${quoteIdentifier(uptTableName)}`,
      `WHERE ${quoteIdentifier(uptActiveColumn)} = 1`,
      `AND ${quoteIdentifier(uptCodeColumn)} NOT IN (:testCodes))`,
    ].join(' ');

    return TbKota.findAll({
      attributes: [
        [literal('KODE_KOTA'), 'KODE_KOTA'],
        [literal('KODE_UPT'), 'KODE_UPT'],
      ],
      where: literal(condition),
      replacements: { testCodes: TEST_UPT_CODES },
      raw: true,
    });
  }
}
