import { Op } from 'sequelize';
import models from '../models/index.js';

import { TEST_UPT_CODES, isTestUptCode, sanitizeLabel } from '../utils/uptCode.js';

// Handle both `default export` and namespace export patterns
const modelsInstance = models?.default || models;
// `hc` di proyek ini diekspor sebagai `dbMaster` (lihat `models/index.js`).
const { TbRUpt, dbMaster } = modelsInstance || {};

if (!TbRUpt || !dbMaster) {
  throw new Error('TbRUpt / dbMaster not found in models/index.js — check export structure');
}

/**
 * Kolom yang dibaca dari master UPT.
 *
 * `NM_PENDEK_BARU` adalah nama resmi terbaru (mis. "Balai PPMHKP Jakarta").
 * Nama lain hanya dipakai sebagai cadangan berurutan bila kolom ini kosong
 * pada sebagian baris.
 */
const SELECTED_COLUMNS = [
  'KD_UNIT',
  'NM_PENDEK_BARU',
  'NM_UNIT_BARU',
  'NM_PENDEK',
  'NM_UNIT',
  'KOTA',
  'STS_AKTIF',
];

/** Attribute Sequelize yang dipakai pada klausa filter. */
const ACTIVE_ATTRIBUTE = 'STS_AKTIF';
const CODE_ATTRIBUTE = 'KD_UNIT';

/**
 * Repository master UPT (`hc.tb_r_upt`).
 *
 * Tabel ini kecil (±40–50 baris) dan relatif statis sehingga selalu dibaca
 * penuh; cache TTL diurus oleh `UptMasterService`, bukan di sini.
 */
class UptMasterRepository {
  /**
   * Kriteria master UPT yang sah dipakai seluruh fitur:
   * unit aktif, bukan data uji/dummy.
   *
   * @returns {object} Objek `where` untuk Sequelize.
   */
  static activeWhere() {
    return {
      [ACTIVE_ATTRIBUTE]: 1,
      [CODE_ATTRIBUTE]: { [Op.notIn]: TEST_UPT_CODES },
    };
  }

  /**
   * Mengambil seluruh baris master UPT yang aktif.
   *
   * @returns {Promise<object[]>} Baris mentah `tb_r_upt`.
   */
  static async findAllActive() {
    const rows = await TbRUpt.findAll({
      attributes: SELECTED_COLUMNS,
      where: UptMasterRepository.activeWhere(),
      order: [[CODE_ATTRIBUTE, 'ASC']],
      raw: true,
    });

    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Normalisasi satu baris master menjadi bentuk baku.
   *
   * Kode dibersihkan dari spasi/CRLF, label dipilih berurutan dari nama resmi
   * terbaru, dan baris tanpa kode maupun tanpa nama yang dapat ditampilkan
   * dibuang.
   *
   * @param {object} row Baris mentah `tb_r_upt`.
   * @returns {{ kdUnit: string, label: string, kota: string, raw: object }|null}
   */
  static normalizeRow(row) {
    const kdUnit = sanitizeLabel(row?.[CODE_ATTRIBUTE]);
    if (kdUnit === '' || isTestUptCode(kdUnit)) {
      return null;
    }

    const label =
      sanitizeLabel(row?.NM_PENDEK_BARU) ||
      sanitizeLabel(row?.NM_UNIT_BARU) ||
      sanitizeLabel(row?.NM_PENDEK) ||
      sanitizeLabel(row?.NM_UNIT) ||
      kdUnit;

    return {
      kdUnit,
      label,
      kota: sanitizeLabel(row?.KOTA),
      raw: row,
    };
  }
}

export default UptMasterRepository;
