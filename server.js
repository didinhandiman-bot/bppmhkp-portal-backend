import dotenv from 'dotenv';
import app from './src/app.js';
import { testConnections } from './src/config/database.js';
import UptMasterService from './src/services/uptMasterService.js';

dotenv.config();

const PORT = process.env.PORT || 5002;

const startServer = async () => {
  console.log('--- BPPMHKP Portal Backend Starting ---');
  await testConnections();

  // `UptMasterService` adalah satu-satunya cache master UPT, dipakai route
  // `/api/v1/options/upt` dan seluruh endpoint `smkhp`. Tanpa pre-load ini
  // cache-nya masih dingin pada request pertama, jadi satu query DB ikut
  // tertunda di respons user. Kegagalan dimuat tidak menghentikan boot,
  // service sudah menyimpan cache kosong berumur pendek bila DB tak terbaca.
  const { count, ok } = await UptMasterService.preload();
  console.log(
    ok
      ? `✅ [UptMaster] ${count} UPT aktif dimuat ke cache TTL.`
      : '⚠️  [UptMaster] Gagal memuat master UPT; nama UPT akan fallback ke transaksi.',
  );

  app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  });
};

startServer();
