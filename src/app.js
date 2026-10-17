import express from 'express';
import cors from 'cors';
import v1Routes from './routes/index.js';
import haccpRoutes from './routes/haccpRoutes.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger: mencatat method, URL, status code, dan waktu eksekusi
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[REQ] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Seluruh rute API versi 1 dikumpulkan di satu router, termasuk modul Primer.
// Hanya prefix `/api/v1` yang perlu terdaftar di sini.
app.use('/api/v1', v1Routes);
// Alias kompatibilitas frontend lama; router yang sama tetap memverifikasi JWT.
// Prefix utama: /api/v1/pasca-panen/haccp melalui routes/index.js.
app.use('/api/pasca-panen/haccp', haccpRoutes);

// Global Error Handler diletakkan paling akhir
app.use(errorHandler);

export default app;