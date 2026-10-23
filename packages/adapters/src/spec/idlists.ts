/**
 * ID-list reconciliation for config-spec sources (PLAN §4.2 "ID lists use reconciliation").
 *
 * A config spec only names a large ID list; its members ship separately through `get_id_lists`
 * as one-way hashes, one `+<hash>` (or `-<hash>` for a removal) per line, where the hash is the
 * first 8 characters of base64(sha256(id)) (node-js-server-sdk Hashing.ts). The customer uploads
 * those files plus a CSV of the raw IDs; the browser hashes the raw IDs and reports coverage.
 * Everything here is pure and runs in the pipeline worker.
 */

/** Applies a `get_id_lists` file (or several, oldest first) to a set of hashes. */
export function parseIdListFile(text: string, into: Set<string> = new Set()): Set<string> {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const op = line[0];
    const hash = line.slice(1).trim();
    if (op === '+') into.add(hash);
    else if (op === '-') into.delete(hash);
    else into.add(line); // a bare hash, e.g. a hand-made file
  }
  return into;
}

/**
 * Raw IDs from a CSV or one-per-line text. The first column is the ID; a header row named like
 * `id`, `user_id`, `userID`, `key` or `unit_id` is skipped; quotes are stripped; duplicates kept
 * once, in first-seen order.
 */
export function parseRawIdCsv(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const cell = raw.split(',')[0]?.trim().replace(/^"(.*)"$/, '$1').trim() ?? '';
    if (!cell) continue;
    if (i === 0 && /^(id|ids|user_?id|userid|unit_?id|key|member|value|stable_?id|device_?id|custom_?id)$/i.test(cell)) continue;
    if (seen.has(cell)) continue;
    seen.add(cell);
    out.push(cell);
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '=');
  }
  return out;
}

/** StatSig's ID-list hash of one raw ID (WebCrypto, so it runs in the browser and in workers). */
export async function statsigIdListHash(id: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(id));
  return base64(new Uint8Array(digest)).slice(0, 8);
}

export interface ReconcileResult {
  /** Raw IDs to migrate: those whose hash StatSig lists (every upload when there is no hash file). */
  ids: string[];
  /** Raw IDs whose hash StatSig doesn't list; left out of the migration. */
  extra: string[];
  coverage: { total: number; matched: number; missing: number; extra: number; verified: boolean };
}

/**
 * Compare a raw-ID upload with StatSig's hashed list. Without hashes (only the list's count is
 * known) every raw ID is taken and coverage is count-based and `verified: false`.
 */
export async function reconcileIdList(rawIds: string[], hashes: Set<string> | undefined, count: number | undefined, opts: { onProgress?: (done: number, total: number) => void; subtle?: SubtleCrypto } = {}): Promise<ReconcileResult> {
  const ids = [...new Set(rawIds)];
  if (!hashes) {
    const total = count ?? ids.length;
    return { ids, extra: [], coverage: { total, matched: Math.min(ids.length, total), missing: Math.max(total - ids.length, 0), extra: Math.max(ids.length - total, 0), verified: false } };
  }
  const matched: string[] = [];
  const extra: string[] = [];
  const seenHashes = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const hs = await Promise.all(slice.map((id) => statsigIdListHash(id, opts.subtle)));
    for (const [j, h] of hs.entries()) {
      if (hashes.has(h)) {
        matched.push(slice[j]!);
        seenHashes.add(h);
      } else extra.push(slice[j]!);
    }
    opts.onProgress?.(Math.min(i + CHUNK, ids.length), ids.length);
  }
  return { ids: matched, extra, coverage: { total: hashes.size, matched: seenHashes.size, missing: hashes.size - seenHashes.size, extra: extra.length, verified: true } };
}
