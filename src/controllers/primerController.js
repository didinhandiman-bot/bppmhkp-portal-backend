import PrimerScopeService from '../services/primerScopeService.js';
import { sendResponse } from '../utils/apiResponse.js';
import PrimerService from '../services/primerService.js';

/**
 * Escape satu sel CSV untuk judul kolom.
 *
 * Sengaja ditulis sebagai fungsi modul, bukan method private `#csvCell` milik kelas.
 * Express memanggil handler statis TANPA mengikatkan `this`, jadi di dalam
 * `this` bernilai `undefined` dan `this.#csvCell(...)` akan melempar
 * `TypeError: Receiver must be class ...` tepat setelah header terkirim —
 * gejalanya respons 200 tetapi badannya kosong. Fungsi modul tidak punya
 * masalah tersebut.
 *
 * @param {*} value
 * @returns {string}
 */
const csvCell = (value) => {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

/**
 * Controller modul Primer.
 *
 * Tugasnya tipis dan sengaja begitu: membaca `req.query`, meneruskannya ke
 * service, lalu mengirim respons. Tidak ada query database, tidak ada
 * perhitungan bisnis, dan tidak ada akses langsung ke repository di sini.
 *
 * Setiap handler memakai bentuk `try / catch` yang meneruskan error ke
 * `next(error)` supaya seluruh penanganan error terpusat di
 * `src/middleware/errorHandler.js`. Tidak ada `try/catch` yang mengembalikan
 * 500 sendiri, karena itu akan memecah pola respons dan menyamarkan pesan
 * asli dari database.
 */
class PrimerController {
  /**
   * GET /api/v1/primer/overview
   * Ringkasan KPI, tren bulanan, dan distribusi wilayah/komoditas.
   */
  static async getOverview(req, res, next) {
    try {
      const query = await PrimerScopeService.getQuery(req.user, req.query);
      const result = await PrimerService.getDashboardOverview(query);

      return sendResponse(
        res,
        200,
        'Ringkasan data primer berhasil dimuat',
        result,
        { filterEfektif: result.filterEfektif }
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/primer/certificates
   * Data tabel sertifikat dengan pagination.
   */
  static async getCertificates(req, res, next) {
    try {
      const query = await PrimerScopeService.getQuery(req.user, req.query);
      const { data, meta } = await PrimerService.getCertificateList(query);

      return sendResponse(res, 200, 'Data sertifikat berhasil dimuat', data, { pagination: meta });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/primer/export
   * Unduh data sertifikat sebagai CSV.
   *
   * Endpoint ini tidak memakai `sendResponse` karena keluarannya adalah berkas,
   * bukan JSON. Baris dikirim sedikit demi sedikit lewat `res.write` sambil
   * menunggu proses `drain` whenever buffer penuh, supaya motherboard dengan
   * data besar tidak menumpuk seluruh keluaran di memori.
   */
  static async exportCertificates(req, res, next) {
    try {
      const query = await PrimerScopeService.getQuery(req.user, req.query);
      const { filename, columns, stream } = await PrimerService.exportCertificateData(query);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // BOM UTF-8. Tanpa ini Excel di Windows membaca karakter non-ASCII
      // (mis. nama berbahasa Indonesia) sebagai mojibake.
      res.write('\uFEFF');
      res.write(`${columns.map((c) => csvCell(c.header)).join(',')}\r\n`);

      for await (const chunk of stream) {
        const siap = !res.write(chunk);
        if (siap) {
          await new Promise((resolve, reject) => {
            res.once('drain', resolve);
            res.once('error', reject);
          });
        }
      }

      return res.end();
    } catch (error) {
      // Kalau header sudah terkirim, `errorHandler` tidak lagi bisa menulis
      // JSON karena koneksi sedang dalam keadaan streaming. Respon dipotong,
      // tapi error tetap dicatat — diam-diam `res.end()` tanpa catatan pernah
      // menyembunyikan bug dan hanya menghasilkan berkas 0 byte.
      if (res.headersSent) {
        console.error('❌ [Primer] Gagal saat menulis CSV, keluaran dipotong:', error);
        res.end();
        return;
      }
      return next(error);
    }
  }

  }

export default PrimerController;
