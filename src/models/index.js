import { dbReport, dbMaster, dbKapal } from '../config/database.js';
import initReportEksport from './ReportEksport.js';
import initTbRUpt from './TbRUpt.js';
import initCbibKapal from './CbibKapal.js';

const ReportEksport = initReportEksport(dbReport);
const TbRUpt = initTbRUpt(dbMaster);
const CbibKapal = initCbibKapal(dbKapal);

export {
  dbReport as sequelize,
  dbReport as sequelizeReport,
  dbMaster,
  dbKapal,
  ReportEksport,
  TbRUpt,
  CbibKapal
};

export default {
  sequelize: dbReport,
  sequelizeReport: dbReport,
  dbMaster,
  dbKapal,
  ReportEksport,
  TbRUpt,
  CbibKapal
};
