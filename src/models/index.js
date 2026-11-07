import { dbReport, dbMaster, dbKapal, dbReportSkp, dbHaccp, dbPrimer } from '../config/database.js';
import initReportEksport from './ReportEksport.js';
import initTbRUpt from './TbRUpt.js';
import initTbKota from './TbKota.js';
import initCbibKapal from './CbibKapal.js';
import initTbSkpPaska from './TbSkpPaska.js';
import initVw07Sertifikasi from './Vw07Sertifikasi.js';
import initTrLaporanPrimerExport from './TrLaporanPrimerExport.js';
import initTbUser from './TbUser.js';
import initTbRole from './TbRole.js';

const ReportEksport = initReportEksport(dbReport);
const TbRUpt = initTbRUpt(dbMaster);
const TbKota = initTbKota(dbMaster);
const CbibKapal = initCbibKapal(dbKapal);
const TbSkpPaska = initTbSkpPaska(dbReportSkp);
const Vw07Sertifikasi = initVw07Sertifikasi(dbHaccp);
const TrLaporanPrimerExport = initTrLaporanPrimerExport(dbPrimer);
const TbUser = initTbUser(dbMaster);
const TbRole = initTbRole(dbMaster);

/**
 * Relasi `tb_user.ROLE` (varchar) -> `tb_role.id` (int). MySQL mengonversi
 * string ke angka secara implisit, sehingga hasilnya setara dengan
 * `CAST(u.ROLE AS UNSIGNED) = r.id` pada query legacy. `constraints: false`
 * karena tabel legacy ini tidak dikelola lewat migrasi Sequelize.
 */
TbUser.belongsTo(TbRole, {
  as: 'role',
  foreignKey: 'ROLE',
  targetKey: 'id',
  constraints: false,
});

export {
  dbReport as sequelize,
  dbReport as sequelizeReport,
  dbMaster,
  dbKapal,
  dbReportSkp,
  dbHaccp,
  dbPrimer,
  ReportEksport,
  TbRUpt,
  TbKota,
  CbibKapal,
  TbSkpPaska,
  Vw07Sertifikasi,
  TrLaporanPrimerExport,
  TbUser,
  TbRole
};

export default {
  sequelize: dbReport,
  sequelizeReport: dbReport,
  dbMaster,
  dbKapal,
  dbReportSkp,
  dbHaccp,
  dbPrimer,
  ReportEksport,
  TbRUpt,
  TbKota,
  CbibKapal,
  TbSkpPaska,
  Vw07Sertifikasi,
  TrLaporanPrimerExport,
  TbUser,
  TbRole
};
