/**
 * "Remember on this device" (PLAN §3.4): tokens encrypted with AES-GCM under a key derived from a
 * passphrase with PBKDF2-SHA-256, stored in IndexedDB, unlocked once per session. The passphrase
 * and the derived key never leave memory; only this blob is persisted. Framework-free: WebCrypto
 * is available in browsers, Web Workers and Node.
 */

export interface VaultBlob {
  version: 1;
  /** PBKDF2 salt, base64. */
  salt: string;
  iterations: number;
  /** AES-GCM IV, base64 (fresh for every write). */
  iv: string;
  /** Encrypted JSON of `Record<string, string>` (secret key → value), base64. */
  ciphertext: string;
}

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256. A few hundred milliseconds in a browser. */
export const VAULT_ITERATIONS = 600_000;

export class WrongPassphraseError extends Error {
  constructor() {
    super("The passphrase doesn't unlock the keys stored on this device.");
    this.name = "WrongPassphraseError";
  }
}

const subtle = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is not available in this context.");
  return c.subtle;
};

export async function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** A derived key plus the parameters it was derived with, kept in memory while unlocked. */
export interface UnlockedVault {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
}

export async function newVaultKey(passphrase: string, iterations = VAULT_ITERATIONS): Promise<UnlockedVault> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveVaultKey(passphrase, salt, iterations), salt, iterations };
}

export async function unlockVaultKey(blob: VaultBlob, passphrase: string): Promise<UnlockedVault> {
  const salt = fromBase64(blob.salt);
  return { key: await deriveVaultKey(passphrase, salt, blob.iterations), salt, iterations: blob.iterations };
}

export async function encryptVault(entries: Record<string, string>, v: UnlockedVault): Promise<VaultBlob> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(entries));
  const ciphertext = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, v.key, plaintext as BufferSource);
  return { version: 1, salt: toBase64(v.salt), iterations: v.iterations, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** Throws WrongPassphraseError when the key doesn't match (AES-GCM authentication fails). */
export async function decryptVault(blob: VaultBlob, v: UnlockedVault): Promise<Record<string, string>> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(blob.iv) as BufferSource }, v.key, fromBase64(blob.ciphertext) as BufferSource);
  } catch {
    throw new WrongPassphraseError();
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WrongPassphraseError();
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
