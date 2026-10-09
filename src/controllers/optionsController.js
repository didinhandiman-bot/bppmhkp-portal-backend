import UptMasterService from '../services/uptMasterService.js';
import { sendResponse } from '../utils/apiResponse.js';

/**
 * Controller untuk endpoint opsi/master.
 *
 * Saat ini hanya memuat opsi UPT. Memakai `UptMasterService` (cache TTL +
 * single-flight), satu-satunya sumber master UPT di project ini. Ia menjaga
 * aturan alias `01.00`/`01.0` → `15.0` sekaligus penyaringan unit uji,
 * sehingga dropdown di sini konsisten dengan seluruh endpoint `smkhp`.
 */
class OptionsController {
  /**
   * GET /api/v1/options/upt
   *
   * Daftar unit aktif dari cache master `hc.tb_r_upt`, sudah dinormalkan dan
   * siap dipakai sebagai nilai filter `kd_upt`.
   *
   * Bentuk tiap item: `{ value, label, kota }`, dengan `value` = `KD_UNIT`
   * kanonik. Ini satu-satunya endpoint yang mengembalikan kode UPT asli;
   * endpoint `GET /upts` yang lama hanya mengembalikan `nama_upt` dari tabel
   * transaksi sehingga tidak bisa dipakai sebagai sumber filter.
   */
  static async getUptOptions(req, res, next) {
    try {
      const options = await UptMasterService.getOptions();

      // `UptMasterService.load()` sengaja tidak melempar error saat gagal
      // membaca DB: ia mengembalikan cache kosong berumur pendek. Tanpa
      // penanda ini, frontend akan menampilkan "0 UPT" seolah-olah memang
      // tidak ada data, padahal master-nya gagal terbaca.
      const degraded = UptMasterService.isDegraded();
      const suffix = degraded
        ? ' (Peringatan: master UPT gagal dimuat dari database.)'
        : '';

      return sendResponse(
        res,
        200,
        `Daftar opsi UPT berhasil diambil. Total ${options.length} unit aktif.${suffix}`,
        options,
      );
    } catch (error) {
      return next(error);
    }
  }
}

/**
 * Ekspor kelas (bukan instance) karena method di atas `static`, sama seperti
 * `smkhpController.js`. Mengekspor `new OptionsController()` membuat
 * `OptionsController.getUptOptions` bernilai undefined dan Express menolak
 * dengan "argument handler must be a function".
 */
export default OptionsController;