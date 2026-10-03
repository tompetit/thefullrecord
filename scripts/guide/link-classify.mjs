/**
 * Pure classification of a link-check outcome. Kept dependency-free so it can
 * be unit tested without network access.
 *
 * ok           final response 2xx/3xx
 * dead         404, 410, DNS failure (ENOTFOUND), connection refused
 * inconclusive 401/403/429/5xx, timeouts, TLS/other network errors, anything else.
 *              Many news sites and .gov WAFs block bots; never treated as dead.
 */
export function classify({ httpStatus, errorCode } = {}) {
  if (typeof httpStatus === 'number') {
    if (httpStatus >= 200 && httpStatus < 400) return 'ok';
    if (httpStatus === 404 || httpStatus === 410) return 'dead';
    return 'inconclusive';
  }
  if (errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED') return 'dead';
  return 'inconclusive';
}

/** Extract a stable error code from a fetch() failure. */
export function errorCodeOf(err) {
  const c = err?.cause?.code ?? err?.code;
  if (c) return String(c);
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'TIMEOUT';
  return 'UNKNOWN';
}
