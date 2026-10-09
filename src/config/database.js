import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

export const dbMaster = new Sequelize(
  process.env.DB_MASTER_NAME || 'hc',
  process.env.DB_MASTER_USER,
  process.env.DB_MASTER_PASS,
  {
    host: process.env.DB_MASTER_HOST,
    port: Number(process.env.DB_MASTER_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 10, min: 2, acquire: 30000, idle: 10000 }
  }
);

export const dbReport = new Sequelize(
  process.env.DB_REPORT_DEFAULT || 'report_siapmutu',
  process.env.DB_REPORT_USER,
  process.env.DB_REPORT_PASS,
  {
    host: process.env.DB_REPORT_HOST,
    port: Number(process.env.DB_REPORT_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 20, min: 5, acquire: 30000, idle: 10000 }
  }
);

/**
 * Koneksi ketiga: `report_skp` (Sertifikasi Kelayakan Pengolahan - Pasca Panen).
 *
 * Terpisah dari `dbReport` meski saat ini masih satu host, karena datanya milik
 * skema yang berbeda. Ikuti aturan yang sama: JANGAN menulis JOIN lintas-koneksi.
 * `report_skp` tidak perlu digabungkan dengan `hc` maupun `report_siapmutu`.
 *
 * Kredensial dibaca dari environment; tidak ada nilai yang di-hardcode di sini.
 * Bila variabel SKP belum diisi di `.env`, instance ini memakai kredensial host
 * report yang sama sebagai fallback supaya migrasi bertahap tetap jalan.
 */
export const dbReportSkp = new Sequelize(
  process.env.DB_SKP_NAME || 'report_skp',
  process.env.DB_SKP_USER || process.env.DB_REPORT_USER,
  process.env.DB_SKP_PASS || process.env.DB_REPORT_PASS,
  {
    host: process.env.DB_SKP_HOST || process.env.DB_REPORT_HOST,
    port: Number(process.env.DB_SKP_PORT) || Number(process.env.DB_REPORT_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 10, min: 2, acquire: 30000, idle: 10000 }
  }
);

/**
 * Koneksi keempat: `report_primer` (laporan perizinan primer).
 *
 * Berisi `tr_laporan_primer_export`. Skemanya satu host dengan `report_*`, jadi
 * kredensial diwarisi dari blok `DB_MUTU_*` dan bisa di-override lewat
 * `DB_PRIMER_*` bila suatu saat dipisah ke host sendiri. Tidak ada nilai yang
 * di-hardcode di sini.
 *
 * CATATAN `DB_MUTU_DEFAULT`: nilainya masih `mutu`. Skema `mutu` memang ada di
 * server, tetapi user aplikasi (`usr_report`) belum diberi hak akses padanya —
 * `authenticate()` ke `dbMutu` akan gagal dengan `ER_DBACCESS_DENIED_ERROR`.
 * Itu murni masalah GRANT di sisi DBA, bukan bug konfigurasi di sini. Begitu
 * `GRANT` diberikan, `dbMutu` langsung bisa dipakai tanpa perubahan kode.
 */
export const dbPrimer = new Sequelize(
  process.env.DB_PRIMER_NAME || 'report_primer',
  process.env.DB_PRIMER_USER || process.env.DB_MUTU_USER,
  process.env.DB_PRIMER_PASS || process.env.DB_MUTU_PASS,
  {
    host: process.env.DB_PRIMER_HOST || process.env.DB_MUTU_HOST,
    port: Number(process.env.DB_PRIMER_PORT) || Number(process.env.DB_MUTU_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 10, min: 2, acquire: 30000, idle: 10000 }
  }
);

/**
 * Koneksi kelima: `mutu` (data master perizinan).
 *
 * Dipisah dari `dbPrimer` karena ini skema berbeda. Ikuti aturan yang sama:
 * JANGAN menulis JOIN lintas-koneksi. `tr_laporan_primer_export` tidak punya
 * kolom yang perlu dilengkapi dari sini, sehingga repository `primer` tidak
 * melakukan JOIN ke skema ini.
 */
export const dbMutu = new Sequelize(
  process.env.DB_MUTU_DEFAULT || 'mutu',
  process.env.DB_MUTU_USER,
  process.env.DB_MUTU_PASS,
  {
    host: process.env.DB_MUTU_HOST,
    port: Number(process.env.DB_MUTU_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
  }
);

/**
 * Koneksi keenam: `CPIB Kapal` (data report perizinan CPIB Kapal).
 *
*/
export const dbKapal = new Sequelize(
  process.env.DB_KAPAL_NAME || 'report_kapal',
  process.env.DB_KAPAL_USER,
  process.env.DB_KAPAL_PASS,
  {
    host: process.env.DB_KAPAL_HOST,
    port: Number(process.env.DB_KAPAL_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
  }
);

/**
 * Koneksi keenam: `haccp` (data report perizinan haccp).
 *
*/
export const dbHaccp = new Sequelize(
  process.env.DB_HACCP_NAME || 'report_haccp',
  process.env.DB_HACCP_USER,
  process.env.DB_HACCP_PASS,
  {
    host: process.env.DB_HACCP_HOST,
    port: Number(process.env.DB_HACCP_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
  }
);

export const testConnections = async () => {
  try {
    await dbMaster.authenticate();
    console.log('✅ Koneksi ke dbMaster (hc) berhasil.');
  } catch (error) {
    console.error('❌ Gagal terkoneksi ke dbMaster (hc):', error.message);
  }

  try {
    await dbReport.authenticate();
    console.log('✅ Koneksi ke dbReport berhasil.');
  } catch (error) {
    console.error('❌ Gagal terkoneksi ke dbReport:', error.message);
  }

  try {
    await dbReportSkp.authenticate();
    console.log('✅ Koneksi ke dbReportSkp (report_skp) berhasil.');
  } catch (error) {
    console.error('❌ Gagal terkoneksi ke dbReportSkp (report_skp):', error.message);
  }

  try {
    await dbPrimer.authenticate();
    console.log('✅ Koneksi ke dbPrimer (report_primer) berhasil.');
  } catch (error) {
    console.error('❌ Gagal terkoneksi ke dbPrimer (report_primer):', error.message);
  }

  // `mutu` saat ini ditolak karena user aplikasi belum diberi GRANT. Pesannya
  // sengaja ditampilkan apa adanya supaya terlihat jelas di log boot bahwa ini
  // keterbatasan hak akses, bukan kegagalan konfigurasi.
  try {
    await dbMutu.authenticate();
    console.log('✅ Koneksi ke dbMutu (mutu) berhasil.');
  } catch (error) {
    console.error(
      '⚠️  Gagal terkoneksi ke dbMutu (mutu):',
      error.parent?.code || error.message,
      '— butuh GRANT untuk user aplikasi pada skema mutu.'
    );
  }
  
  // kapal
  try {
    await dbKapal.authenticate();
    console.log('✅ Koneksi ke dbKapal (kapal) berhasil.');
  } catch (error) {
    console.error(
      '⚠️  Gagal terkoneksi ke dbKapal (kapal):',
      error.parent?.code || error.message,
      '— butuh GRANT untuk user aplikasi pada skema kapal.'
    );
  }

  // kapal
  try {
    await dbHaccp.authenticate();
    console.log('✅ Koneksi ke dbHaccp (haccp) berhasil.');
  } catch (error) {
    console.error(
      '⚠️  Gagal terkoneksi ke dbHaccp (haccp):',
      error.parent?.code || error.message,
      '— butuh GRANT untuk user aplikasi pada skema haccp.'
    );
  }
  
};
