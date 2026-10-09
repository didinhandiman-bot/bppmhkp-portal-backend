/**
 * Utilitas murni untuk Modul SKP (Sertifikasi Kelayakan Pengolahan) - Pasca Panen.
 *
 * Sengaja tanpa import apa pun: fungsi-fungsi ini dipakai bersama oleh jalur
 * periode berjalan maupun periode pembanding (YoY) di `skpService.js`, jadi
 * harus dapat dipanggil tanpa efek samping.
 *
 * Catatan penting (hasil verifikasi langsung ke report_skp, 2026-10-01):
 * - Hanya tahun 2025 dan 2026 yang terisi. Tahun lain mengembalikan 0 baris
 *   dengan HTTP 200; itu jawaban yang benar, bukan bug.
 * - `skala_usaha` TIDAK konsisten. Ada dua kosakata yang hidup berdampingan,
 *   yaitu "Skala Mikro : <= 1.000.000.000" (4.797 baris) dan "Usaha Mikro"
 *   (1.141 baris), ditambah varian yang memakai "?" sebagai pengganti tanda
 *   pisah (183 baris) dan placeholder "-" (16 baris). `GROUP BY` polos akan
 *   memunculkan 12 bucket, bukan 4, sehingga grafik tidak bisa dipakai.
 * - Karena itu WAJIB memakai ekspresi normalisasi yang sama di `WHERE` filter,
 *   di `GROUP BY`, dan di label daftar. Kalau tidak, "Mikro" muncul sebagai
 *   tiga baris terpisah dengan label berbeda.
 * - `peringkat` terlihat bersih (A/B/C) tetapi tetap di-TRIM + UPPER sebagai
 *   pengaman terhadap char(1) yang someday diisi spasi.
 */

/** Nama bulan singkat untuk label grafik tren. */
export const NAMA_BULAN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/**
 * Empat bucket skala usaha sesuai klasifikasi UMKM.
 * Dipakai sebagai nilai kanonik pada sumbu grafik dan sebagai nilai yang
 * boleh dikirim frontend pada parameter filter `skalaUsaha`.
 */
export const BUCKET_SKALA_USAHA = ['Mikro', 'Kecil', 'Menengah', 'Besar'];

/** Nilai `skala_usaha` yang tidak bermakna (baris belum diisi di sisi UPI). */
export const SKALA_TAK_TERISI = '-';

/**
 * Ambang hari untuk status `expiring_soon`.
 *
 * Ini aturan bisnis, bukan detail SQL, jadi konstantanya tinggal di sini lalu
 * diteruskan repository sebagai parameter. Sebelumnya angka 30 ditulis dua kali
 * di dalam repository (sekali untuk filter, sekali untuk badge kolom) sehingga
 * mudah goyah saat aturan berubah dan tidak bisa diuji tanpa database.
 */
export const EXPIRING_SOON_DAYS = 30;

/**
 * Menyusun ekspresi SQL CASE yang memetakan `skala_usaha` mentah ke bucket kanonik.
 *
 * Dipakai persis sama oleh filter dan GROUP BY; inilah penjaga terhadap bucket
 * yang terpecah (lihat catatan di header berkas).
 *
 * @param {string} column Ekspresi kolom sumber, misal `skala_usaha`.
 * @returns {string} Ekspresi SQL CASE yang menghasilkan bucket kanonik.
 */
export function buildSkalaUsahaCase(column = 'skala_usaha') {
  const c = `LOWER(TRIM(${column}))`;

  return `CASE
    WHEN ${c} = '' OR ${c} = '${SKALA_TAK_TERISI}' THEN NULL
    WHEN ${c} LIKE '%mikro%' THEN 'Mikro'
    WHEN ${c} LIKE '%kecil%' THEN 'Kecil'
    WHEN ${c} LIKE '%menengah%' THEN 'Menengah'
    WHEN ${c} LIKE '%besar%' THEN 'Besar'
    ELSE 'Lainnya'
  END`;
}

/**
 * Menentukan rentang tanggal [awal, akhir) untuk satu tahun kalender.
 *
 * Bentuk rentang (`>= :start AND < :endNext`) dipakai alih-alih
 * `YEAR(tanggal_terbit) = :year` karena bentuk YEAR() membungkus kolom sehingga
 * tidak dapat memakai index, sedangkan rentang bersifat sargable. Untuk kolom
 * bertipe `date` keduanya menghasilkan himpunan baris yang sama.
 *
 * @param {number} year Tahun kalender, misal 2026.
 * @returns {{start: string, endNext: string}} Rentang YYYY-MM-DD.
 */
export function getYearRange(year) {
  const y = Number(year);
  return {
    start: `${y}-01-01`,
    endNext: `${y + 1}-01-01`,
  };
}

/**
 * Menghitung pertumbuhan persentase tahun ke tahun.
 *
 * Bila periode pembanding kosong, hasilnya `null` dan bukan 0: `null` berarti
 * "tidak ada dasar pembanding", sedangkan 0 berarti "pertumbuhan nol", dan
 * keduanya punya arti berbeda bagi frontend.
 *
 * @param {number} current Nilai periode berjalan.
 * @param {number} previous Nilai periode pembanding.
 * @returns {number|null} Persentase dengan 2 desimal, atau null.
 */
export function calcYoYGrowth(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;

  if (before === 0) {
    return null;
  }

  return Math.round(((now - before) / before) * 10000) / 100;
}

/**
 * Menentukan tahun default dari waktu server.
 *
 * Memakai UTC agar label tahun tidak meleset satu angka di sekitar tengah malam
 * (WIB); `tanggal_terbit` diisi sebagai tanggal lokal tanpa jam.
 *
 * @param {Date} [now] Waktu acuan, dapat diganti saat pengujian.
 * @returns {number} Tahun berjalan.
 */
export function getDefaultYear(now = new Date()) {
  return now.getUTCFullYear();
}

/**
 * Membersihkan label dari newline dan carriage return.
 *
 * `nama_upi`, `nama_produk`, `provinsi`, dan `kota_kabupaten` di tabel ini memuat
 * newline (hasil ekspor PDF), yang membuat baris tabel di frontend terlihat
 * berantakan.
 *
 * @param {string} value Nilai mentah dari database.
 * @returns {string|null} Teks satu baris, atau null bila input null.
 */
export function sanitizeLabel(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value).replace(/\s+/g, ' ').trim();
}
