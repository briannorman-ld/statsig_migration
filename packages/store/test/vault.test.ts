import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { decryptVault, encryptVault, MigratorDb, newVaultKey, unlockVaultKey, WorkspaceStore, WrongPassphraseError } from "../src/index.ts";

const FAST = 1000; // iterations: tests only; the app uses VAULT_ITERATIONS

describe("encrypted token vault", () => {
  it("round-trips secrets under a passphrase and refuses the wrong one", async () => {
    const v = await newVaultKey("correct horse battery staple", FAST);
    const blob = await encryptVault({ "ld:w1": "api-secret", "statsig:s1": "console-secret" }, v);
    expect(blob.version).toBe(1);
    expect(blob.iterations).toBe(FAST);
    expect(JSON.stringify(blob)).not.toContain("api-secret");
    expect(await decryptVault(blob, await unlockVaultKey(blob, "correct horse battery staple"))).toEqual({ "ld:w1": "api-secret", "statsig:s1": "console-secret" });
    await expect(decryptVault(blob, await unlockVaultKey(blob, "wrong"))).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("uses a fresh IV on every write", async () => {
    const v = await newVaultKey("p", FAST);
    const a = await encryptVault({ k: "v" }, v);
    const b = await encryptVault({ k: "v" }, v);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("stores only the blob, and deletes it with the workspace", async () => {
    const s = new WorkspaceStore(new MigratorDb(`test-${crypto.randomUUID()}`));
    const ws = await s.createWorkspace({ name: "Vaulted" });
    const blob = await encryptVault({ "ld:x": "api-secret" }, await newVaultKey("p", FAST));
    await s.saveVault(ws.id, blob);
    expect((await s.getVault(ws.id))?.blob).toEqual(blob);
    await s.deleteWorkspace(ws.id);
    expect(await s.getVault(ws.id)).toBeUndefined();
  });
});
