import HaccpRepository from '../repositories/haccpRepository.js';

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s === '' ? null : s;
};

function normalizeFilters(raw = {}) {
  const out = { _uptRestricted: raw._uptRestricted === true };
  if (raw.startDate) out.startDate = String(raw.startDate).slice(0, 10);
  if (raw.endDate) out.endDate = String(raw.endDate).slice(0, 10);
  if (out.startDate && out.endDate && out.startDate > out.endDate) {
    const t = out.startDate; out.startDate = out.endDate; out.endDate = t;
  }
  if (raw.kd_unit || raw.kdUnit) out.kdUnit = String(raw.kd_unit || raw.kdUnit).trim();
  if (raw.id_upt || raw.idUpt) out.idUpt = String(raw.id_upt || raw.idUpt).trim();
  if (raw.grade) out.grade = String(raw.grade).trim();
  if (raw.status_sert || raw.statusSert) out.statusSert = String(raw.status_sert || raw.statusSert).trim();
  if (raw.search) {
    const s = String(raw.search).trim().slice(0, 100);
    if (s) out.search = s;
  }
  return out;
}

class HaccpService {
  static async getKpi(raw = {}) {
    const f = normalizeFilters(raw);
    return await HaccpRepository.getKpi(f);
  }

  static async getCharts(raw = {}) {
    const f = normalizeFilters(raw);
    const [gradeDistribution, statusProduk, kategoriProduk, topProduk, topUpt, monthlyTrend, investmentDistribution] = await Promise.all([
      HaccpRepository.getGradeDistribution(f),
      HaccpRepository.getStatusProduk(f),
      HaccpRepository.getKategoriProduk(f),
      HaccpRepository.getTopProduk(f, 10),
      HaccpRepository.getTopUpt(f, 10),
      HaccpRepository.getMonthlyTrend(f),
      HaccpRepository.getInvestmentDistribution(f),
    ]);
    return {
      gradeDistribution,
      statusProduk,
      kategoriProduk,
      topProduk,
      topUpt,
      monthlyTrend,
      investmentDistribution,
    };
  }

  static async getTable(raw = {}) {
    const f = normalizeFilters(raw);
    const { rows, count, page: p, limit: l } = await HaccpRepository.getTable(f, { page: raw.page, limit: raw.limit });
    const data = rows.map(r => ({
      no_haccp: clean(r.no_haccp),
      upi_name: clean(r.upi_name),
      nama_produk: clean(r.nama_produk),
      nama_kategori: clean(r.nama_kategori),
      grade: clean(r.grade),
      upt: clean(r.upt),
      tgl_terbit: r.tgl_terbit,
      tgl_akhir: r.tgl_akhir,
      status_sert: clean(r.status_sert),
    }));
    const totalPages = count > 0 ? Math.ceil(count / l) : 0;
    return {
      pagination: {
        totalRows: count,
        totalPages,
        currentPage: p,
        limit: l,
      },
      data,
    };
  }
}

export default HaccpService;
