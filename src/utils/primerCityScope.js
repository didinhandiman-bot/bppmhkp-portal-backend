import { buildInClause } from './uptCode.js';
import { AppError } from '../errors/appError.js';

/** Scope internal tidak berasal dari URL; daftar kosong tidak membuka data nasional. */
export function cityScopeCondition(cityScope, replacements) {
  if (!Array.isArray(cityScope) || cityScope.some(code => typeof code !== 'string' || !/^\d{4}$/.test(code))) {
    throw new AppError('Scope kota Primer tidak valid', 403);
  }
  if (!cityScope.length) return '1 = 0';
  return 'LEFT(kd_daerah, 4) IN (' + buildInClause([...new Set(cityScope)], 'primerCity', replacements) + ')';
}
