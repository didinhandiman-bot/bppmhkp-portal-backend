import CityUptService from './cityUptService.js';
import EksporRepository from '../repositories/eksporRepository.js';
import PascaPanenRepository from '../repositories/pascaPanenRepository.js';
import PrimerRepository from '../repositories/primerRepository.js';
import UptMasterService from './uptMasterService.js';
import PrimerScopeService from './primerScopeService.js';
import { normalizeUptCode, sanitizeLabel } from '../utils/uptCode.js';

function identity(row, labels, cityMappings) {
  const raw = sanitizeLabel(row.unitKey);
  if (row.source === 'primer') {
    const unit = cityMappings.get(raw);
    return unit ? {key:'upt:' + unit, label:labels.get(unit) || 'UPT ' + unit} :
      {key:'unmapped-city:' + raw,label:'Primer - Kota belum dipetakan ' + (raw || 'tidak diketahui')};
  }
  if (row.source === 'kapal') return { key: 'kapal:' + raw, label: 'Kapal ? ' + (raw || 'UPT inspeksi tidak diketahui') };
  // Alias Jakarta hanya berlaku pada transaksi ekspor, bukan klaim kode SKP/HACCP.
  const code = row.source === 'ekspor' ? normalizeUptCode(raw) : raw;
  return { key: 'upt:' + code, label: labels.get(code) || 'UPT ' + (code || 'tidak diketahui') };
}

export default class DashboardOverviewService {
  static async getOverviewMetrics(filters = {}) {
    // Pemanggilan service langsung juga tidak boleh mengabaikan uptId Primer.
    if (filters.uptId && !filters.cityScope) filters = await PrimerScopeService.getQuery({isNationalAccess:true}, filters);
    const { isNationalAccess, ...repoFilters } = filters;
    const [ekspor, pascaPanen, primer, eksporTrends, pascaTrends, primerTrends, eksporUpts, pascaUpts, primerUpts, eksporActivities, pascaActivities, primerActivities, entries, cityMappings] = await Promise.all([
      EksporRepository.getAggregatedSummary(repoFilters),
      PascaPanenRepository.getAggregatedSummary(repoFilters),
      PrimerRepository.getAggregatedSummary({ ...repoFilters, isNationalAccess }),
      EksporRepository.getMonthlyTrends(repoFilters),
      PascaPanenRepository.getMonthlyTrends(repoFilters),
      PrimerRepository.getDashboardMonthlyTrends(repoFilters),
      EksporRepository.getByUpt(repoFilters),
      PascaPanenRepository.getByUpt(repoFilters),
      PrimerRepository.getByUpt(repoFilters),
      EksporRepository.getRecentActivities(repoFilters),
      PascaPanenRepository.getRecentActivities(repoFilters),
      PrimerRepository.getRecentActivities(repoFilters),
      UptMasterService.getEntries(),
      CityUptService.getMappings(),
    ]);
    const labels = new Map(entries.map(entry => [entry.kdUnit, sanitizeLabel(entry.label)]));
    const months = new Map();
    const distributions = new Map();
    for (const [field, rows] of [['ekspor',eksporTrends],['pascaPanen',pascaTrends],['primer',primerTrends]]) {
      for (const row of rows) {
        if (!row.month) continue;
        const month = String(row.month);
        if (!months.has(month)) months.set(month,{month,ekspor:0,pascaPanen:0,primer:0});
        months.get(month)[field] += Number(row.total || 0);
      }
    }
    for (const [field, rows] of [['ekspor',eksporUpts],['pascaPanen',pascaUpts],['primer',primerUpts]]) {
      for (const row of rows) {
        const unit = identity(row,labels,cityMappings);
        if (!distributions.has(unit.key)) distributions.set(unit.key,{namaUpt:unit.label,ekspor:0,pascaPanen:0,primer:0,grandTotal:0});
        const bucket=distributions.get(unit.key);
        bucket[field] += Number(row.total || 0);
        bucket.grandTotal += Number(row.total || 0);
      }
    }
    // SMKHP muncul pada ekspor dan pascapanen, tetapi feed hanya menampilkan sekali.
    const activities = new Map();
    for (const row of [...eksporActivities,...pascaActivities,...primerActivities]) {
      const date = row.date instanceof Date ? row.date.toISOString() : String(row.date || '');
      const id = row.source + ':' + String(row.recordId ?? '') + ':' + date + ':' + String(row.unitKey ?? '');
      activities.set(id,{id,module:row.module,serviceName:row.serviceName,applicant:sanitizeLabel(row.applicant),upt:identity(row,labels,cityMappings).label,date,status:'Terbit'});
    }
    const detail=primer.detail || {};
    return {
      summaryKpi: {
        ekspor,pascaPanen,
        primer:{totalSertifikat:Number(primer.totalSertifikat || 0),totalPending:Number(primer.totalPending || 0),detail},
        totalSertifikasiNasional:Number(pascaPanen.totalSertifikatTerbit || 0)+Number(primer.totalSertifikat || 0),
      },
      scope:{primerUpt:filters.uptId || null,primerCities:filters.cityScope || null,kapalIncluded:!filters.cityScope,primerDistribution:'upt'},
      monthlyTrends:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),
      uptDistribution:[...distributions.values()].sort((a,b)=>b.grandTotal-a.grandTotal||a.namaUpt.localeCompare(b.namaUpt)),
      recentActivities:[...activities.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,10),
    };
  }
}
