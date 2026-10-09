import UptMasterRepository from '../repositories/uptMasterRepository.js';
import {
  UPT_CODE_ALIASES,
  isPrimaryUptCode,
  normalizeUptCode,
  sanitizeLabel,
  TRANSACTION_UPT_CODE_COLUMN,
  TRANSACTION_UPT_NAME_COLUMN,
} from '../utils/uptCode.js';

/** Batas masa berlaku cache sesuai ketentuan (1–12 jam). */
const MIN_TTL_MS = 60 * 60 * 1000;
const MAX_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Masa berlaku cache singkat saat pembacaan master gagal.
 *
 * Master UPT praktis tidak pernah berubah, sehingga setelah kegagalan sekali
 * (jaringan putus, restart DB) kita tidak perlu mencoba ulang pada setiap
 * request; 5 menit cukup untuk shrug lewat gangguan sesaat.
 */
const FAILURE_TTL_MS = 5 * 60 * 1000;

/**
 * Service master UPT.
 *
 * Tanggung jawab:
 * - memuat `hc.tb_r_upt` **satu kali** lalu memakainya sebagai peta in-memory,
 * - menyediakan `Map<KD_UNIT, NM_PENDEK_BARU>` untuk lookup di level service,
 * - menyuplai opsi dropdown `{ value, label }`.
 *
 * Semua pembacaan bersifat read-only dan tidak pernah membuat JOIN lintas
 * database: `tb_r_upt` dibaca lewat koneksi `hc`, sedangkan data transaksi
 * dibaca lewat koneksi `report_siapmutu`, lalu keduanya digabung di memori.
 */
class UptMasterService {
  /** @type {{ loadedAt: number, entries: object[], labels: Map<string,string>, ok: boolean }|null} */
  static #cache = null;

  /** @type {Promise<object>|null} Mencegah pembacaan paralel ganda. */
  static #inflight = null;

  /** Membaca TTL dari env, dikunci ke rentang 1–12 jam. */
  static get ttlMs() {
    const rawMs = Number.parseInt(process.env.UPT_MASTER_CACHE_TTL_MS ?? '', 10);
    if (Number.isFinite(rawMs) && rawMs >= 0) {
      return Math.min(Math.max(rawMs, MIN_TTL_MS), MAX_TTL_MS);
    }

    const rawHours = Number.parseFloat(process.env.UPT_MASTER_CACHE_TTL_HOURS ?? '');
    if (Number.isFinite(rawHours) && rawHours > 0) {
      return Math.min(Math.max(rawHours * 60 * 60 * 1000, MIN_TTL_MS), MAX_TTL_MS);
    }

    return DEFAULT_TTL_MS;
  }

  /** Masa berlaku cache saat pembacaan master gagal. */
  static get failureTtlMs() {
    const raw = Number.parseInt(process.env.UPT_MASTER_CACHE_FAILURE_TTL_MS ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : FAILURE_TTL_MS;
  }

  /** Status apakah cache terakhir gagal dimuat (dipakai health check). */
  static isDegraded() {
    return UptMasterService.#cache !== null && UptMasterService.#cache.ok === false;
  }

  /** Waktu cache terakhir dimuat dalam milidetik epoch. */
  static get loadedAt() {
    return UptMasterService.#cache?.loadedAt ?? null;
  }

  /**
   * Mengubah baris master menjadi daftar unit yang sudah bersih.
   *
   * @param {object[]} rows Baris mentah `tb_r_upt`.
   * @returns {object[]} Daftar `{ kdUnit, label, kota }`.
   */
  static #normalizeRows(rows) {
    return rows
      .map((row) => UptMasterRepository.normalizeRow(row))
      .filter((entry) => entry !== null);
  }

  /**
   * Membangun peta label dari daftar unit.
   *
   * Kode disimpan dua kali: sesuai `KD_UNIT` asli (agar baris transaksi dengan
   * kode yang persis sama langsung kena) dan sebagai kode kanonik untuk alias
   * (agar `01.00`/`01.0` menghasilkan label `15.0`). Kode kanonik tidak pernah
   * menimpa entri bertanda alias, sehingga unit aslinya tetap dipegang.
   *
   * @param {object[]} entries Daftar unit ternormalisasi.
   * @returns {Map<string, string>} Peta kode -> nama UPT.
   */
  static #buildLabelMap(entries) {
    const labels = new Map();

    for (const entry of entries) {
      labels.set(entry.kdUnit, entry.label);
    }

    for (const entry of entries) {
      const canonical = normalizeUptCode(entry.kdUnit);
      if (canonical && !labels.has(canonical)) {
        labels.set(canonical, entry.label);
      }
    }

    return labels;
  }

  /**
   * Memuat (atau mengambil dari cache) master UPT.
   *
   * Kegagalan tidak dilempar ke pemanggil: peta kosong dikembalikan sehingga
   * fitur lain tetap jalan dengan fallback ke `tr_report_ekspor.nama_upt`.
   *
   * @param {{ force?: boolean }} options Paksa muat ulang bila `force` true.
   * @returns {Promise<{ entries: object[], labels: Map<string,string>, ok: boolean }>}
   */
  static async load({ force = false } = {}) {
    const now = Date.now();
    const cached = UptMasterService.#cache;

    if (!force && cached !== null) {
      const ttl = cached.ok ? UptMasterService.ttlMs : UptMasterService.failureTtlMs;
      if (now - cached.loadedAt < ttl) {
        return cached;
      }
    }

    // Single-flight: beberapa request paralel berbagi satu pembacaan database.
    if (UptMasterService.#inflight !== null) {
      return UptMasterService.#inflight;
    }

    UptMasterService.#inflight = (async () => {
      try {
        const rows = await UptMasterRepository.findAllActive();
        const entries = UptMasterService.#normalizeRows(rows);
        const result = {
          loadedAt: Date.now(),
          entries,
          labels: UptMasterService.#buildLabelMap(entries),
          ok: true,
        };

        UptMasterService.#cache = result;
        return result;
      } catch (error) {
        // Cache kosong berlaku singkat: jangan membanjiri database tiap request.
        const result = {
          loadedAt: Date.now(),
          entries: [],
          labels: new Map(),
          ok: false,
        };

        UptMasterService.#cache = result;
        console.error(
          '[upt-master] Gagal memuat master UPT dari `hc.tb_r_upt`.' +
            ' Nama UPT akan memakai nilai `tr_report_ekspor.nama_upt`.',
          error?.message ?? error
        );
        return result;
      } finally {
        UptMasterService.#inflight = null;
      }
    })();

    return UptMasterService.#inflight;
  }

  /**
   * Mengambil daftar unit master (sudah bersih).
   *
   * @returns {Promise<object[]>} Daftar `{ kdUnit, label, kota }`.
   */
  static async getEntries() {
    const { entries } = await UptMasterService.load();
    return entries;
  }

  /**
   * Mengambil peta label UPT.
   *
   * @returns {Promise<Map<string, string>>} Peta `KD_UNIT` -> `NM_PENDEK_BARU`.
   */
  static async getLabelMap() {
    const { labels } = await UptMasterService.load();
    return labels;
  }

  /**
   * Mencari nama UPT berdasarkan kode.
   *
   * Urutan usaha:
   * 1. kode mentah apa adanya,
   * 2. kode kanonik hasil normalisasi alias (`01.00` -> `15.0`),
   * 3. `fallback` (biasanya `tr_report_ekspor.nama_upt`).
   *
   * @param {unknown} kodeUpt Kode UPT.
   * @param {string} [fallback] Nilai pengganti bila master tidak memuat kode.
   * @returns {Promise<string>} Nama UPT siap pakai.
   */
  static async resolveName(kodeUpt, fallback = '') {
    const rawCode = sanitizeLabel(kodeUpt);
    if (rawCode === '') {
      return sanitizeLabel(fallback);
    }

    const labels = await UptMasterService.getLabelMap();
    return (
      labels.get(rawCode) ??
      labels.get(normalizeUptCode(rawCode) ?? rawCode) ??
      sanitizeLabel(fallback)
    );
  }

  /**
   * Menormalkan `kode_upt` dan menimpa `nama_upt` pada baris transaksi.
   *
   * Dipanggil setelah query transaksi, bukan lewat JOIN, karena kedua tabel
   * berada pada database berbeda.
   *
   * Dua hal yang ditangani, dan sengaja dipisahkan:
   * - `kode_upt` dinormalkan ke kode utama kelompok (`01.00`/`01.0` -> `15.0`).
   *   Ini aturan lokal di `uptCode.js`, jadi tetap dijalankan walau master UPT
   *   gagal dibaca; bentuk respons tidak berubah-ubah tergantung cache. Nilai
   *   ini juga sama dengan `kode_upt` yang dipakai agregasi, sehingga tabel
   *   transaksi dan rekap UPT memakai satu kode yang sama.
   * - `nama_upt` diisi dari master. Bila kodenya tidak ada di master atau
   *   master sama sekali tidak terbaca, nilai `nama_upt` dari transaksi
   *   dipertahankan sebagai fallback.
   *
   * @param {object[]} rows Baris hasil query transaksi.
   * @returns {Promise<object[]>} Baris dengan `kode_upt` ternormalisasi & `nama_upt` termap.
   */
  static async applyToRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return Array.isArray(rows) ? rows : [];
    }

    const labels = await UptMasterService.getLabelMap();

    return rows.map((row) => {
      if (row === null || typeof row !== 'object') {
        return row;
      }

      const rawCode = sanitizeLabel(row[TRANSACTION_UPT_CODE_COLUMN]);
      if (rawCode === '') {
        return row;
      }

      const canonicalCode = normalizeUptCode(rawCode) ?? rawCode;
      const label = labels.get(rawCode) ?? labels.get(canonicalCode);

      return {
        ...row,
        [TRANSACTION_UPT_CODE_COLUMN]: canonicalCode,
        [TRANSACTION_UPT_NAME_COLUMN]: label ?? row[TRANSACTION_UPT_NAME_COLUMN],
      };
    });
  }

  /**
   * Menyusun opsi dropdown UPT.
   *
   * `01.0` (Tangerang/Jakarta I) dan `15.0` (Jakarta/Jakarta II) memakai
   * `NM_PENDEK_BARU` yang sama, sehingga opsi akan tampak ganda bila tidak
   * digabung. Baris yang labelnya identik dilebur, dan pemenang kelompok
   * memilih kode utamanya (`15.0`) agar nilainya sama dengan nilai filter
   * maupun `kode_upt` yang dikembalikan agregasi.
   *
   * @returns {Promise<{ value: string, label: string, kota: string }[]>} Opsi terurut `KD_UNIT`.
   */
  static async getOptions() {
    const entries = await UptMasterService.getEntries();

    /** @type {Map<string, { value: string, label: string, kota: string, rank: number }>} */
    const byLabel = new Map();

    entries.forEach((entry, index) => {
      if (entry.label === '') {
        return;
      }

      const candidate = { value: entry.kdUnit, label: entry.label, kota: entry.kota, rank: index };
      const existing = byLabel.get(entry.label);

      if (existing === undefined) {
        byLabel.set(entry.label, candidate);
        return;
      }

      // Kode utama kelompok alias menang atas kode alias; bila keduanya bukan
      // kode utama, ambil yang lebih kecil agar hasil deterministik.
      const existingIsPrimary = isPrimaryUptCode(existing.value);
      const candidateIsPrimary = isPrimaryUptCode(candidate.value);

      if (existingIsPrimary && !candidateIsPrimary) {
        return;
      }

      if (!existingIsPrimary && candidateIsPrimary) {
        byLabel.set(entry.label, candidate);
        return;
      }

      if (existingIsPrimary === candidateIsPrimary && candidate.rank < existing.rank) {
        byLabel.set(entry.label, candidate);
      }
    });

    return [...byLabel.values()]
      .sort((a, b) => a.rank - b.rank)
      .map(({ value, label, kota }) => ({ value, label, kota }));
  }

  /**
   * Mengosongkan cache agar perubahan master terbaca tanpa restart.
   *
   * @param {boolean} forceReload Muat ulang seketika bila `true`.
   * @returns {Promise<{ entries: object[], ok: boolean }>}
   */
  static async clearCache(forceReload = true) {
    UptMasterService.#cache = null;
    if (forceReload) {
      const { entries, ok } = await UptMasterService.load({ force: true });
      return { entries, ok };
    }
    return { entries: [], ok: true };
  }

  /**
   * Memuat master saat aplikasi start supaya request pertama tidak menunggu DB.
   *
   * @returns {Promise<{ count: number, ok: boolean }>}
   */
  static async preload() {
    const { entries, ok } = await UptMasterService.load({ force: true });
    return { count: entries.length, ok };
  }
}

/** Kode kanonik hasil pemetaan alias; dipakai dokumentasi/health check. */
export const UPT_CANONICAL_CODES = [...new Set(UPT_CODE_ALIASES.values())];

export default UptMasterService;
