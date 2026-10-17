import dotenv from 'dotenv';

// Konfigurasi dimuat sebelum validasi, termasuk saat middleware diimpor langsung.
dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET;
if (typeof JWT_SECRET !== 'string' || !JWT_SECRET.trim()) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing');
}
