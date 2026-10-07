const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Deterministic base62 ID that looks like a StatSig ID (22 chars by default). */
export function pseudoId(seed: string, length = 22): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  let out = '';
  let a = h1 >>> 0;
  let b = h2 >>> 0;
  while (out.length < length) {
    // xorshift the two lanes to produce more digits
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    b = Math.imul(b ^ (b >>> 15), 2246822507) >>> 0;
    out += ALPHABET[((a ^ b) >>> 0) % 62];
    a >>>= 0;
  }
  return out;
}
