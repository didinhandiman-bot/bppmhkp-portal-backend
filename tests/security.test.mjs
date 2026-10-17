import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import jwt from 'jsonwebtoken';

// Pengujian tidak membaca .env dan tidak membuka koneksi database.
globalThis.securityQueries = [];
registerHooks({ load(url, context, nextLoad) {
  if (url.includes('/node_modules/dotenv/')) return { format: 'module', shortCircuit: true, source: 'export default { config() {} };' };
  if (url.endsWith('/src/config/database.js')) return { format: 'module', shortCircuit: true, source: `
    const db = { QueryTypes: { SELECT: 'SELECT' }, query: async (sql, options) => { globalThis.securityQueries.push({sql, options}); if(sql.includes('hc.tb_kota')) return [{KODE_KOTA:'3101',KODE_UPT:'15.0'},{KODE_KOTA:'3102',KODE_UPT:'47.0'}]; return []; } };
    export const dbMaster=db, dbReport=db, dbReportSkp=db, dbPrimer=db, dbKapal=db, dbHaccp=db, dbMutu=db;
  ` };
  if (url.endsWith('/src/models/index.js')) return { format: 'module', shortCircuit: true, source: `
    import { dbMaster, dbReport } from '../config/database.js';
    export { dbMaster }; export default { dbMaster, TbRUpt: {}, sequelize: dbReport, sequelizeReport: dbReport };
  ` };
  return nextLoad(url, context);
}});
process.env.JWT_SECRET = 'test-only-secret-for-security-regression';
const { scopedUptQuery } = await import('../src/utils/uptScope.js');
const limited = { roleId: 2, isNationalAccess: false, kdUnit: '15.0' };
const malicious = {kd_upt:'47.0', kode_upt:'47.0', upt:'Other', uptId:'47.0', kd_unit:'47.0', kdUnit:'47.0', id_upt:'47.0', idUpt:'47.0', upt_kode:'47.0', search:'a'};
const scoped = scopedUptQuery(limited, malicious);
assert.equal(scoped.kd_unit, '15.0'); assert.equal(scoped.kd_upt, '15.0'); assert.equal(scoped.uptId, '15.0'); assert.equal(scoped.id_upt, undefined); assert.equal(malicious.kd_unit, '47.0');
assert.equal(scopedUptQuery({isNationalAccess:true}, malicious).kd_unit,'47.0');
for (const u of [{}, {isNationalAccess:'true'}, {isNationalAccess:false}, {isNationalAccess:false,kdUnit:' '}]) assert.throws(()=>scopedUptQuery(u), /Klaim/);
const HaccpService = (await import('../src/services/haccpService.js')).default;
await HaccpService.getKpi(scoped); await HaccpService.getCharts(scoped); await HaccpService.getTable(scoped);
for(const q of globalThis.securityQueries){assert.match(q.sql,/kd_unit = :upt/);assert.doesNotMatch(q.sql,/OR id_upt/);assert.equal(q.options.replacements.upt,'15.0');}
globalThis.securityQueries.length=0;
const SkpService = (await import('../src/services/skpService.js')).default;
await SkpService.getSummaryMetrics(scoped); await SkpService.getMonthlyTrends(scoped); await SkpService.getDistribution(scoped); await SkpService.getTableList(scoped);
for(const q of globalThis.securityQueries){assert.match(q.sql,/kd_unit = :kdUnit/);assert.equal(q.options.replacements.kdUnit,'15.0');}
const ExportRepository = (await import('../src/repositories/smkhpRepository.js')).default;
const filter=ExportRepository.buildWhereClause(scoped); assert.match(filter.whereStr,/kode_upt IN/); assert.ok(Object.values(filter.replacements).includes('15.0')); assert.ok(!Object.values(filter.replacements).includes('47.0'));
await ExportRepository.getUpts(scoped); assert.match(globalThis.securityQueries.at(-1).sql,/kode_upt IN/);
const authRepository = (await import('../src/repositories/authRepository.js')).default;
const bcrypt = (await import('bcryptjs')).default;
const authService = (await import('../src/services/authService.js')).default;
let sessionUpdates = 0;
const passwordHash = await bcrypt.hash('test-password', 4);
authRepository.findByUsername = async () => ({USER_ID:1, ROLE_ID:2, STATUS:'1', PASSWORD:passwordHash, KD_UNIT:null});
authRepository.updateLoginSession = async () => {sessionUpdates++;};
await assert.rejects(authService.login('test','test-password','127.0.0.1'), /kode UPT/);
assert.equal(sessionUpdates,0);
authRepository.findByUsername = async () => ({USER_ID:1, ROLE_ID:2, STATUS:'1', PASSWORD:passwordHash, KD_UNIT:'15.0'});
const loginResult = await authService.login('test','test-password','127.0.0.1');
assert.equal(jwt.verify(loginResult.token,process.env.JWT_SECRET).kdUnit,'15.0');
assert.equal(jwt.verify(loginResult.token,process.env.JWT_SECRET).isNationalAccess,false);
const UptMasterService = (await import('../src/services/uptMasterService.js')).default;
UptMasterService.getEntries = async () => [{kdUnit:'15.0',raw:{KD_PROP:'31'}},{kdUnit:'47.0',raw:{KD_PROP:'32'}}];
UptMasterService.getOptions = async () => [{value:'01.00',label:'Jakarta'}, {value:'47.0',label:'Other'}];
const app = (await import('../src/app.js')).default;
const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
try {
 for(const prefix of ['/api/v1/pasca-panen/haccp','/api/pasca-panen/haccp']) for(const route of ['/kpi','/charts','/table']) {
  assert.equal((await fetch(base+prefix+route)).status,401);
  assert.equal((await fetch(base+prefix+route,{headers:{Authorization:'Bearer invalid'}})).status,403);
  const token=jwt.sign(limited,process.env.JWT_SECRET);
  assert.equal((await fetch(base+prefix+route+'?kd_unit=47.0&id_upt=47.0',{headers:{Authorization:'Bearer '+token}})).status,200);
 }
 const token=jwt.sign(limited,process.env.JWT_SECRET);
 for(const path of ['/api/v1/primer/overview','/api/v1/primer/certificates','/api/v1/primer/export','/api/v1/dashboard/overview']) {
  globalThis.securityQueries.length=0;
  const response = await fetch(base+path+'?kdDaerah=3201&provinceScope=32&uptId=47.0',{headers:{Authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  await response.text();
  const queries=globalThis.securityQueries.filter(q=>q.sql.includes('tr_laporan_primer_export'));
  assert.ok(queries.length>0);
  for(const q of queries){assert.match(q.sql,/LEFT\(kd_daerah, 4\) IN/);assert.equal(q.options.replacements.primerCity0,'3101');}
  assert.ok(!globalThis.securityQueries.some(q=>q.sql.includes('tb_cbib_kapal')));
 }
 for(const path of ['/api/v1/primer/overview','/api/v1/primer/certificates','/api/v1/primer/export']) {
  assert.equal((await fetch(base+path+'?kdIzin=032000000033',{headers:{Authorization:'Bearer '+token}})).status,403);
 }
 const PrimerScopeService=(await import('../src/services/primerScopeService.js')).default;
 assert.equal((await PrimerScopeService.getQuery({isNationalAccess:true},{provinceScope:'32'})).provinceScope,undefined);
 assert.deepEqual((await PrimerScopeService.getQuery({isNationalAccess:true},{uptId:'47.0'})).cityScope,['3102']);
 assert.deepEqual((await PrimerScopeService.getQuery(limited,{cityScope:['3102'],provinceScope:'32',uptId:'47.0'})).cityScope,['3101']);
 await assert.rejects(PrimerScopeService.getQuery({...limited,kdUnit:'unknown'}),/pemetaan kota/);
 const CityUptRepository=(await import('../src/repositories/cityUptRepository.js')).default;
 const originalMappings=CityUptRepository.findMappings;
 CityUptRepository.findMappings=async()=>[{KODE_KOTA:'3101',KODE_UPT:'15.0'},{KODE_KOTA:'3101',KODE_UPT:'47.0'}];
 await assert.rejects(PrimerScopeService.getQuery(limited),/ambigu/);
 CityUptRepository.findMappings=originalMappings;
 const {cityScopeCondition}=await import('../src/utils/primerCityScope.js');
 assert.equal(cityScopeCondition([],{}),'1 = 0');
 assert.throws(()=>cityScopeCondition(['31'],{}),/tidak valid/);
 globalThis.securityQueries.length=0;
 const national=jwt.sign({roleId:1,isNationalAccess:true},process.env.JWT_SECRET);
 assert.equal((await fetch(base+'/api/v1/pasca-panen/haccp/kpi?kd_unit=47.0',{headers:{Authorization:'Bearer '+national}})).status,200);
 assert.equal(globalThis.securityQueries.at(-1).options.replacements.upt,'47.0');
 const optionsResponse=await fetch(base+'/api/v1/options/upt?kd_upt=47.0',{headers:{Authorization:'Bearer '+token}});
 assert.equal(optionsResponse.status,200); assert.deepEqual((await optionsResponse.json()).data,[{value:'01.00',label:'Jakarta'}]);
 const badClaims=jwt.sign({roleId:2},process.env.JWT_SECRET);
 assert.equal((await fetch(base+'/api/v1/pasca-panen/haccp/kpi',{headers:{Authorization:'Bearer '+badClaims}})).status,403);
} finally { await new Promise(r=>server.close(r)); }
const validation=spawnSync(process.execPath,['--input-type=module','-e', `
 import { registerHooks } from 'node:module';
 registerHooks({load(url,c,next){if(url.includes('/node_modules/dotenv/'))return {format:'module',shortCircuit:true,source:'export default { config() {} };'};return next(url,c);}});
 delete process.env.JWT_SECRET;
 await import('./src/config/auth.js');
`],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
assert.notEqual(validation.status,0); assert.match(validation.stderr,/FATAL: JWT_SECRET environment variable is missing/);
console.log('PASS: JWT validation, HACCP guards, UPT override, SQL scope, Primer city/UPT scope, CSV scope, unmapped kapal rejection.');
