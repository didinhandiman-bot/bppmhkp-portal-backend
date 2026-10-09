/**
 * Utilitas kode & nama UPT.
 *
 * Master UPT (`hc.tb_r_upt`) memakai `KD_UNIT` dua digit desimal (`01.0` …
 * `47.0`, plus `98.0`/`99.0` untuk data uji), sedangkan tabel transaksi
 * `report_siapmutu.tr_report_ekspor` menyimpan `kode_upt` dengan format
 * yang tidak konsisten antar sumber (`01.00`, `01.0`, `15.0`, …).
 *
 * Modul ini menjadi satu-satunya tempat yang tahu aturan normalisasi tersebut
 * supaya repository, service, dan controller tidak masing-masing mendefinisikan
 * pemetaan yang berbeda. Aturan pada `UPT_CODE_ALIASES` berlaku seragam untuk
 * filter, agregasi, maupun lookup nama, sehingga satu unit tidak pernah muncul
 * sebagai dua baris dengan label nama yang sama.
 */

/** Kolom kode UPT pada tabel transaksi. */
export const TRANSACTION_UPT_CODE_COLUMN = 'kode_upt';

/** Kolom nama UPT pada tabel transaksi. */
export const TRANSACTION_UPT_NAME_COLUMN = 'nama_upt';

/**
 * Kode unit uji/dummy yang harus diabaikan oleh seluruh fitur UPT.
 * Nilainya `STS_AKTIF = 1`, jadi tidak bisa disaring hanya dari kolom aktif.
 */
export const TEST_UPT_CODES = Object.freeze(['98.0', '99.0']);

/**
 * Alias kode UPT: kode yang dilaporkan sebagai satu entitas dengan kode lain.
 *
 * `01.0` dan `01.00` dilaporkan sebagai `15.0` — ketiganya berlabel
 * "Balai PPMHKP Jakarta". Aturan ini berlaku seragam di tiga tempat sekaligus:
 * filter (`WHERE`), agregasi (`GROUP BY`), dan lookup nama. Efeknya satu unit
 * tidak pernah muncul sebagai dua baris berpayload nama identik, sehingga
 * frontend cukup menerima satu baris `15.0` per kelompok Jakarta.
 *
 * @type {ReadonlyMap<string, string>} peta alias -> kode utama.
 */
export const UPT_CODE_ALIASES = new Map([
  ['01.00', '15.0'],
  ['01.0', '15.0'],
]);

/** Kode utama hasil penggabungan alias. */
const UPT_PRIMARY_CODES = new Set(UPT_CODE_ALIASES.values());

/**
 * Membersihkan teks label UPT.
 *
 * Data master memuat karakter newline/CR di beberapa kolom (`NM_PENDEK`)
 * sehingga harus dirapikan sebelum dikirim ke dropdown.
 *
 * @param {unknown} value Nilai mentah dari database.
 * @returns {string} Teks tanpa spasi berlebih; string kosong bila tidak ada.
 */
export function sanitizeLabel(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Menormalkan kode UPT ke bentuk kanonik.
 *
 * Mengembalikan nilai aslinya (tanpa spasi) bila tidak ada alias terdaftar,
 * sehingga kode yang tidak dikenal tetap dapat dipakai sebagai filter.
 *
 * @param {unknown} value Kode UPT dari request maupun database.
 * @returns {string|null} Kode kanonik, atau `null` bila input kosong.
 */
export function normalizeUptCode(value) {
  const code = sanitizeLabel(value);
  if (code === '') {
    return null;
  }
  return UPT_CODE_ALIASES.get(code) ?? code;
}

/**
 * Menghasilkan daftar kode mentah yang harus dicocokkan di SQL agar satu
 * pilihan filter pada dropdown sama dengan seluruh baris transaksi unit itu.
 *
 * Untuk kode utama hasilnya memuat kode utama lebih dulu (agar nilai yang
 * dikembalikan stabil), diikuti kode legacy dan seluruh kode dalam lipatan
 * filter. Tanpa ini, filter `kd_upt=15.0` akan kehilangan baris ber-kode
 * `01.00` maupun `01.0`.
 *
 * @param {unknown} value Kode UPT dari request.
 * @returns {string[]} Daftar kode mentah; kosong bila input kosong.
 */
/**
 * Menghasilkan daftar kode mentah yang harus dicocokkan di SQL agar satu
 * pilihan filter mewakili seluruh baris transaksi kelompok tersebut.
 *
 * Untuk kode utama hasilnya memuat kode utama lebih dulu (agar nilai yang
 * dikembalikan stabil), diikuti seluruh alias yang mengarah kepadanya.
 * Tanpa ini, filter `kd_upt=15.0` akan kehilangan baris ber-kode `01.00`/`01.0`.
 *
 * @param {unknown} value Kode UPT dari request.
 * @returns {string[]} Daftar kode mentah; kosong bila input kosong.
 */
export function expandUptCodeFilter(value) {
  const raw = sanitizeLabel(value);
  if (raw === '') {
    return [];
  }

  const canonical = UPT_CODE_ALIASES.get(raw) ?? raw;
  const codes = [canonical];

  for (const [alias, target] of UPT_CODE_ALIASES) {
    if (target === canonical && !codes.includes(alias)) {
      codes.push(alias);
    }
  }

  return codes;
}

/**
 * Menyusun placeholder + replacement untuk klausa `IN` pada raw SQL.
 *
 * Nilai tidak pernah disisipkan langsung ke string SQL (selalu lewat
 * `replacements`) agar aman dari injeksi maupun kutip yang tidak berjackpot.
 *
 * @param {string[]} codes Daftar kode dari `expandUptCodeFilter`.
 * @param {string} paramPrefix Prefix placeholder, mis. `'upt'`.
 * @param {Record<string, unknown>} replacements Target objek replacements.
 * @returns {string} Fragmen SQL, mis. `":upt0, :upt1"`; string kosong bila `codes` kosong.
 */
export function buildInClause(codes, paramPrefix, replacements) {
  if (!Array.isArray(codes) || codes.length === 0) {
    return '';
  }

  codes.forEach((code, index) => {
    replacements[`${paramPrefix}${index}`] = code;
  });

  return codes.map((_code, index) => `:${paramPrefix}${index}`).join(', ');
}

/**
 * Menyusun ekspresi SQL yang menggabungkan seluruh alias yang dikenal.
 *
 * Dipakai `GROUP BY`/`SELECT` pada agregasi per UPT agar bucket `01.0`/`01.00`
 * tidak muncul sebagai baris tersendiri: semua ikut dihitung di bawah kode
 * utama `15.0`. Dengan begitu penjumlahan volume, nilai, dan count dokumen
 * terjadi di database (satu kali pemindaian) dan tidak ada baris ganda.
 *
 * @param {string} column Ekspresi kolom sumber, mis. `TRIM(kode_upt)`.
 * @param {Record<string, unknown>} replacements Target objek replacements.
 * @param {string} paramPrefix Prefix placeholder.
 * @returns {string} Ekspresi `CASE WHEN … THEN … ELSE … END`.
 */
export function buildFullUptGroupByExpression(column, replacements, paramPrefix = 'uptgrp') {
  const canonicalByAlias = new Map();
  for (const [alias, canonical] of UPT_CODE_ALIASES) {
    if (!canonicalByAlias.has(canonical)) {
      canonicalByAlias.set(canonical, []);
    }
    canonicalByAlias.get(canonical).push(alias);
  }

  // Placeholder dedup: satu placeholder per kode kanonik.
  const canonicalParam = new Map();
  for (const canonical of canonicalByAlias.keys()) {
    const key = `${paramPrefix}canon${canonicalParam.size}`;
    replacements[key] = canonical;
    canonicalParam.set(canonical, key);
  }

  const branches = [];
  for (const [canonical, aliases] of canonicalByAlias) {
    const inClause = buildInClause(aliases, `${paramPrefix}alias`, replacements);
    branches.push(`WHEN ${column} IN (${inClause}) THEN :${canonicalParam.get(canonical)}`);
  }

  if (branches.length === 0) {
    return column;
  }

  return `CASE ${column} ${branches.join(' ')} ELSE ${column} END`;
}

/**
 * Menggabungkan baris agregasi yang memiliki kode UPT sama.
 *
 * Cadangan bila `GROUP BY` dijalankan di level database tanpa ekspresi `CASE`,
 * dan untuk merapikan data yang sudah terkelompok sebagian. Memakai
 * `normalizeUptCode`, sehingga seluruh alias ikut dilebur ke kode utamanya.
 *
 * @param {object[]} rows Baris agregasi dengan kolom kode UPT.
 * @param {string} codeField Nama kolom kode.
 * @param {string[]} sumFields Kolom numerik yang dijumlahkan.
 * @returns {object[]} Baris baru dengan kode ternormalisasi & bucket menyatu.
 */
export function mergeUptGroups(rows, codeField, sumFields) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  /** @type {Map<string, object>} */
  const merged = new Map();
  /** @type {Map<string, number>} */
  const indexByCode = new Map();

  for (const row of rows) {
    const originalCode = sanitizeLabel(row[codeField]);
    const canonical = normalizeUptCode(originalCode) ?? originalCode;

    if (merged.has(canonical)) {
      const target = merged.get(canonical);
      for (const field of sumFields) {
        target[field] = (Number(target[field]) || 0) + (Number(row[field]) || 0);
      }
      continue;
    }

    indexByCode.set(canonical, indexByCode.size);
    merged.set(canonical, { ...row, [codeField]: canonical, __aliases: originalCode });
  }

  return [...merged.entries()]
    .sort((a, b) => indexByCode.get(a[0]) - indexByCode.get(b[0]))
    .map(([, value]) => {
      const { __aliases, ...rest } = value;
      return rest;
    });
}

/**
 * Menentukan kode yang harus mewakili kelompok alias pada dropdown.
 *
 * `01.0` dan `15.0` sama-sama berlabel "Balai PPMHKP Jakarta" sehingga hanya
 * boleh muncul satu opsi; kode utama kelompok (`15.0`) yang dipakai sebagai
 * `value` agar sama dengan nilai filter dan dengan `kode_upt` pada agregasi.
 *
 * @param {unknown} code Kode UPT.
 * @returns {boolean} `true` bila kode adalah kode utama suatu kelompok alias.
 */
export function isPrimaryUptCode(code) {
  return UPT_PRIMARY_CODES.has(sanitizeLabel(code));
}

/** Mengembalikan `true` bila kode termasuk data uji/dummy. */
export function isTestUptCode(code) {
  return TEST_UPT_CODES.includes(sanitizeLabel(code));
}
