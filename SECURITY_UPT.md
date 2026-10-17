# Pembatasan akses UPT

- JWT_SECRET wajib tersedia; tidak ada fallback. Endpoint HACCP pada prefix utama /api/v1/pasca-panen/haccp dan alias lama sama-sama terlindungi JWT.
- Pengguna terbatas harus memiliki klaim isNationalAccess boolean false dan kdUnit yang terisi. Scope berasal dari token, bukan parameter URL.
- SMKHP tetap memakai normalisasi kode transaksi. SKP/HACCP memakai kode unit yang sesuai klaim.

## Primer: pemetaan kota ke UPT

Tabel yang digunakan source tetap report_primer.tr_laporan_primer_export. Nama tabel tidak diubah berdasarkan variasi penamaan dalam percakapan.

Relasi otorisasi: LEFT(kd_daerah, 4) -> hc.tb_kota.KODE_KOTA -> hc.tb_kota.KODE_UPT -> hc.tb_r_upt.KD_UNIT. Pemetaan kota dibaca lewat dbMaster, dengan JOIN hanya di hc untuk memeriksa UPT aktif dan mengecualikan UPT uji. Filter Primer memakai daftar kode kota terparameterisasi melalui dbPrimer; tidak ada JOIN lintas database.

Kode kota harus empat digit dan tetap berupa string agar nol awal tidak hilang. Kode UPT dicocokkan persis setelah TRIM; alias analitik tidak dipakai untuk memperluas kewenangan kota. Pemetaan ambigu ditolak. Pengguna UPT tanpa kota yang terpetakan mendapat 403. Daftar kota kosong di repository menghasilkan WHERE 1 = 0. Kegagalan database tidak membuka akses nasional.

Scope internal cityScope/provinceScope dari URL dibuang. Pengguna nasional tanpa pilihan UPT melihat seluruh data; pilihan UPT juga dipetakan ke daftar kota. kdDaerah tetap boleh mempersempit hasil, tetapi tidak memperluas daftar kota.

Filter sama berlaku pada KPI, grafik, tabel, COUNT, CSV, dan ringkasan/tren/aktivitas dashboard. Distribusi Primer dikelompokkan menurut empat digit kota lalu digabung ke UPT di service. Kota yang belum terpetakan ditandai eksplisit untuk hasil nasional.

## Kapal

Tidak ada relasi baru untuk tb_cbib_kapal. Akses nasional tanpa pilihan UPT tetap memakai perilaku sebelumnya. Hasil berscope mengecualikan kapal; endpoint kapal berscope ditolak sampai upt_inspeksi mempunyai pemetaan terpercaya.

## Verifikasi

npm run test:security, npm run test:dashboard, npm run test:sequelize menggunakan Node 24. Pengujian SQL memakai database tiruan; pengujian Sequelize menggunakan implementasi asli untuk named imports dan tujuh instance MySQL. Seluruh pengujian menonaktifkan dotenv dan tidak menghubungi database. Data/pemetaan pada database langsung belum diverifikasi.
