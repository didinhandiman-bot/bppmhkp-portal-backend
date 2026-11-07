import { dbReport, dbMaster, dbKapal, dbReportSkp, dbHaccp, dbPrimer } from '../config/database.js';
import initReportEksport from './ReportEksport.js';
import initTbRUpt from './TbRUpt.js';
import initTbKota from './TbKota.js';
import initCbibKapal from './CbibKapal.js';
import initTbSkpPaska from './TbSkpPaska.js';
import initVw07Sertifikasi from './Vw07Sertifikasi.js';
import initTrLaporanPrimerExport from './TrLaporanPrimerExport.js';

const ReportEksport = initReportEksport(dbReport);
const TbRUpt = initTbRUpt(dbMaster);
const TbKota = initTbKota(dbMaster);
const CbibKapal = initCbibKapal(dbKapal);
const TbSkpPaska = initTbSkpPaska(dbReportSkp);
const Vw07Sertifikasi = initVw07Sertifikasi(dbHaccp);
const TrLaporanPrimerExport = initTrLaporanPrimerExport(dbPrimer);

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
  TrLaporanPrimerExport
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
  TrLaporanPrimerExport
};
