import EksporRepository from '../repositories/eksporRepository.js';
import PascaPanenRepository from '../repositories/pascaPanenRepository.js';
import PrimerRepository from '../repositories/primerRepository.js';

class DashboardOverviewService {
  static async getOverviewMetrics({ startDate, endDate, uptId } = {}) {
    const [ekspor, pascaPanen, primer] = await Promise.all([
      EksporRepository.getAggregatedSummary({ startDate, endDate, uptId }),
      PascaPanenRepository.getAggregatedSummary({ startDate, endDate, uptId }),
      PrimerRepository.getAggregatedSummary({ startDate, endDate, uptId }),
    ]);
    const totalSertifikasiNasional = Number(pascaPanen.totalSertifikatTerbit || 0) + Number(primer.totalSertifikatTerbit || 0);
    return {
      summaryKpi: { ekspor, pascaPanen, primer: (function(p){
        const pd=p||{}; const pk=pd.kpi||pd; const d=(pk.detail)||(pd.detail)||{};
        return {
          totalSertifikat: Number(pk.totalSertifikat ?? pk.totalSertifikatTerbit ?? 0),
          totalPending: Number(pk.totalPending ?? 0),
          detail: { cpib:Number(d.cpip||d.cpib||0), cbib:Number(d.cbib||0), cppib:Number(d.cppib||0), cpoib:Number(d.cpoib||0), cdoib:Number(d.cdoib||0), cpibKapal:Number(d.cpibKapal||d.cpipKapal||0) }
        };
      })(primer), totalSertifikasiNasional },
      monthlyTrends: [],
      uptDistribution: [],
      recentActivities: []
    };
  }
}
export default DashboardOverviewService;
