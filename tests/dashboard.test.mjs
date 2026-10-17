import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
globalThis.dashboardQueries=[];
globalThis.dashboardQuery = async (sql, options) => {
 globalThis.dashboardQueries.push({sql,options});
 if(sql.includes('hc.tb_kota')) return [{KODE_KOTA:'3101',KODE_UPT:'15.0'},{KODE_KOTA:'3102',KODE_UPT:'47.0'}];
 if(sql.includes('DATE_FORMAT')) return [{month:'2025-01',total:'2'},{month:'2026-01',total:'3'}];
 if(sql.includes('AS unitKey, COUNT')) return [{unitKey:sql.includes('kd_daerah')?'3101':'15.0',total:'5'}];
 if(sql.includes('AS recordId')) return [{recordId:'issued-1',applicant:' Perusahaan A ',unitKey:sql.includes('kd_daerah')?'3101':'skp',date:'2026-01-15'}];
 if(sql.includes(' AS c ')) return [{c:'1'}];
 if(sql.includes('totalFrekuensi')) return [{totalFrekuensi:'5',totalPengajuan:'4',totalVolumeKg:'100',totalNilaiRupiah:'200'}];
 return [{total:'5',berlaku:'3'}];
};
registerHooks({load(url,c,next){
 if(url.includes('/node_modules/dotenv/'))return {format:'module',shortCircuit:true,source:'export default {config(){}};'};
 if(url.endsWith('/src/config/database.js'))return {format:'module',shortCircuit:true,source:"const db={QueryTypes:{SELECT:'SELECT'},query:globalThis.dashboardQuery}; export const dbReport=db,dbMaster=db,dbReportSkp=db,dbHaccp=db,dbPrimer=db,dbKapal=db,dbMutu=db;"};
 if(url.endsWith('/src/models/index.js'))return {format:'module',shortCircuit:true,source:"import {dbReport,dbMaster} from '../config/database.js'; export {dbMaster}; export default {TbRUpt:{},dbMaster,sequelize:dbReport,sequelizeReport:dbReport};"};
 return next(url,c);
}});
const UptMasterService=(await import('../src/services/uptMasterService.js')).default;
UptMasterService.getEntries=async()=>[{kdUnit:'15.0',label:'Jakarta',raw:{KD_PROP:'31'}}];
const DashboardService=(await import('../src/services/dashboardOverviewService.js')).default;
const PrimerRepository=(await import('../src/repositories/primerRepository.js')).default;
await assert.rejects(PrimerRepository.getAggregatedSummary({uptId:'15.0'}),/Scope kota wajib/);
const data=await DashboardService.getOverviewMetrics({uptId:'15.0',startDate:'2025-01-01',endDate:'2026-12-31'});
assert.deepEqual(data.monthlyTrends,[{month:'2025-01',ekspor:2,pascaPanen:6,primer:2},{month:'2026-01',ekspor:3,pascaPanen:9,primer:3}]);
// SKP tidak punya kolom UPT → distribution SKP dikosongkan. pascaPanen = ekspor(5) + haccp(5) = 10
assert.deepEqual(data.uptDistribution,[{namaUpt:'Jakarta',ekspor:5,pascaPanen:10,primer:5,grandTotal:20}]);
assert.equal(data.recentActivities.length,4); // SMKHP feed dua pilar dideduplikasi.
assert.equal(new Set(data.recentActivities.map(x=>x.id)).size,4);
assert.equal(data.summaryKpi.primer.totalSertifikat,5);
assert.equal(data.summaryKpi.totalSertifikasiNasional,20);
assert.equal(data.scope.kapalIncluded,false);
assert.ok(!globalThis.dashboardQueries.some(q=>q.sql.includes('tb_cbib_kapal')));
for(const q of globalThis.dashboardQueries){
 if(q.sql.includes('tr_laporan_primer_export')){assert.match(q.sql,/LEFT\(kd_daerah, 4\) IN/);assert.equal(q.options.replacements.primerCity0,'3101');}
 // SKP distribution dikosongkan (noUptColumn), jadi tidak ada query GROUP BY kode_upt.
 // Hanya summary/monthly/activities yang dieksekusi untuk SKP.
 const isSkpActivities = q.sql.includes('tb_skp_paska') && q.sql.includes('nomor_skp AS recordId');
 const isSkpSummary = q.sql.includes('tb_skp_paska') && q.sql.includes('COUNT(*) AS total') && q.sql.includes('berlaku');
 if(isSkpActivities){assert.match(q.sql,/nomor_skp AS recordId/);assert.match(q.sql,/'skp' AS unitKey/);}
 if(isSkpSummary){assert.match(q.sql,/berlaku/);}
 if(q.sql.includes('vw07_sertifikasi')){assert.match(q.sql,/kd_unit = :upt/);assert.match(q.sql,/\bOR\b/);assert.equal(q.options.replacements.upt,'15.0');}
 assert.ok(!q.sql.includes("'15.0'"));
}
globalThis.dashboardQueries.length=0;
const national=await DashboardService.getOverviewMetrics({startDate:'2026-01-01'});
assert.equal(national.scope.kapalIncluded,true);
assert.equal(national.summaryKpi.primer.totalSertifikat,6);
assert.ok(national.recentActivities.some(x=>x.serviceName==='CPIB Kapal'));
for(const q of globalThis.dashboardQueries.filter(q=>!q.sql.includes('hc.tb_kota')))assert.ok(String(q.options.replacements.startDate).startsWith('2026-01-01'));
assert.ok(globalThis.dashboardQueries.some(q=>q.sql.includes('no_cbib AS recordId')));
console.log('PASS: seeded dashboard results, cross-year trends, scope SQL, city-to-UPT attribution, deduplication, national kapal.');