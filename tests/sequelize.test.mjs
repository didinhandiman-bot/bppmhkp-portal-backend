import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Sequelize, QueryTypes, Op, DataTypes } from 'sequelize';
// Import menggunakan implementasi Sequelize asli, tanpa membaca .env/koneksi DB.
registerHooks({load(url,c,next){if(url.includes('/node_modules/dotenv/'))return {format:'module',shortCircuit:true,source:'export default {config(){}};'};return next(url,c);}});
process.env.JWT_SECRET='test-only-sequelize-import-secret';
const database=await import('../src/config/database.js');
const handles=['dbMaster','dbReport','dbReportSkp','dbPrimer','dbMutu','dbKapal','dbHaccp'];
try {
 assert.match(Sequelize.version,/^6\.37\./);
 assert.ok(QueryTypes.SELECT && Op.notIn && DataTypes.STRING);
 for(const name of handles){assert.ok(database[name] instanceof Sequelize);assert.equal(database[name].getDialect(),'mysql');}
 await import('../src/app.js');
 console.log('PASS: Sequelize '+Sequelize.version+', ESM named imports, seven MySQL instances, models and app import.');
} finally { await Promise.all(handles.map(name=>database[name].close())); }
