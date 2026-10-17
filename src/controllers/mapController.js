import MapService from '../services/mapService.js';
import { sendResponse } from '../utils/apiResponse.js';

/**
 * Controller endpoint peta sebaran (`GET /api/v1/landing/peta-sebar`).
 *
 * Tugasnya tipis: membaca `req.query.tahun`, meneruskannya ke service, lalu
 * mengirim respons berenvelope standar. Tidak ada query database maupun
 * perhitungan bisnis di sini.
 *
 * Endpoint ini PUBLIK (tidak melewati `verifyToken`) karena dipakai landing
 * page. Karena itu tahun yang tidak valid tidak dijadikan error 400 — service
 * menggantinya dengan tahun berjalan (lihat `MapService#resolveYear`).
 */
class MapController {
  /**
   * GET /api/v1/landing/peta-sebar?tahun=YYYY
   *
   * Mengembalikan `data` berupa array per provinsi dengan kunci
   * `kodeProvinsi` yang sama dengan `properties.KODE_PROV` pada GeoJSON
   * `38-Provinsi-Indonesia.json`.
   */
  static async getPetaSebaran(req, res, next) {
    try {
      const data = await MapService.getPetaSebaran(req.query.tahun);

      return sendResponse(
        res,
        200,
        'Data sebaran penerbitan sertifikasi berhasil diambil',
        data,
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/landing/upt-marker
   *
   * Titik lokasi seluruh UPT aktif (koordinat sudah dinormalkan dari kolom
   * `BUJUR`/`LINTANG` master). Dipakai peta sebaran untuk menampilkan marker
   * berdenyut; endpoint ini publik karena menemani `peta-sebar` di landing page.
   */
  static async getUptMarkers(req, res, next) {
    try {
      const data = await MapService.getUptMarkers();

      return sendResponse(res, 200, 'Data titik UPT berhasil diambil', data);
    } catch (error) {
      return next(error);
    }
  }
}

export default MapController;
