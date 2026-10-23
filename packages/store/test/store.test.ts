import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { emptySnapshot } from "@sslm/canonical";
import {
  assertNoSecrets,
  DuplicateWorkspaceNameError,
  MigratorDb,
  SecretInStoreError,
  WorkspaceStore,
} from "../src/index.ts";

const store = () =>
  new WorkspaceStore(new MigratorDb(`test-${crypto.randomUUID()}`));
let n = 0;
const source = (id: string) => ({
  id,
  alias: id,
  label: `acme-${id}`,
  kind: "console_api" as const,
  createdAt: `2026-01-01T00:00:0${n++}Z`,
});

describe("WorkspaceStore (Dexie / IndexedDB)", () => {
  it("stores a workspace with N sources and immutable snapshots", async () => {
    const s = store();
    const ws = await s.createWorkspace({
      name: "Acme Retail (Demo)",
      isDemo: true,
    });
    await s.addSource(ws.id, source("web"));
    await s.addSource(ws.id, source("mobile"));
    expect((await s.listSources(ws.id)).map((x) => x.alias)).toEqual([
      "web",
      "mobile",
    ]);

    const snap1 = emptySnapshot(
      { sourceId: "web", sourceKind: "console_api", alias: "web" },
      "2026-01-01T00:00:00Z",
    );
    const snap2 = { ...snap1, takenAt: "2026-01-02T00:00:00Z" };
    await s.saveSnapshot(ws.id, snap1);
    const r2 = await s.saveSnapshot(ws.id, snap2);
    expect((await s.latestSnapshot("web"))?.id).toBe(r2.id);
    expect((await s.listSnapshots("web")).map((x) => x.takenAt)).toEqual([
      "2026-01-02T00:00:00Z",
      "2026-01-01T00:00:00Z",
    ]);
    expect(await s.latestSnapshot("mobile")).toBeUndefined();
  });

  it("refuses a second workspace with the same name, ignoring case and surrounding spaces", async () => {
    const s = store();
    const a = await s.createWorkspace({ name: "  Contoso migration " });
    expect(a.name).toBe("Contoso migration");
    await expect(
      s.createWorkspace({ name: "contoso MIGRATION" }),
    ).rejects.toBeInstanceOf(DuplicateWorkspaceNameError);
    const b = await s.createWorkspace({ name: "Contoso staging" });
    await expect(
      s.updateWorkspace(b.id, { name: "Contoso Migration" }),
    ).rejects.toBeInstanceOf(DuplicateWorkspaceNameError);
    await s.updateWorkspace(b.id, { name: "Contoso staging" }); // renaming to your own name is fine
    expect((await s.listWorkspaces()).map((w) => w.name).sort()).toEqual([
      "Contoso migration",
      "Contoso staging",
    ]);
  });

  it("prunes old snapshots per source, keeping the newest N and any a run was planned from", async () => {
    const s = store();
    const ws = await s.createWorkspace({ name: "x" });
    await s.addSource(ws.id, source("web"));
    await s.addSource(ws.id, source("mobile"));
    const at = (i: number) => `2026-01-${String(i).padStart(2, "0")}T00:00:00Z`;
    for (let i = 1; i <= 6; i++)
      await s.saveSnapshot(
        ws.id,
        emptySnapshot(
          { sourceId: "web", sourceKind: "console_api", alias: "web" },
          at(i),
        ),
      );
    const mobile = await s.saveSnapshot(
      ws.id,
      emptySnapshot(
        { sourceId: "mobile", sourceKind: "console_api", alias: "mobile" },
        at(1),
      ),
    );
    await s.saveSpecUpload({
      workspaceId: ws.id,
      sourceId: "web",
      filename: "a.json",
      bytes: 1,
      version: 2,
      json: {},
      snapshotId: (await s.listSnapshots("web")).at(-1)!.id,
    });
    // A run planned from the oldest web snapshot protects it.
    await s.saveRun({
      id: "run1",
      workspaceId: ws.id,
      projectKey: "p",
      label: "l",
      dryRun: false,
      startedAt: at(6),
      status: "succeeded",
      steps: [],
      snapshots: [{ sourceId: "web", takenAt: at(1) }],
    } as never);
    const removed = await s.pruneSnapshots(ws.id, "web", 3);
    expect(removed).toHaveLength(2); // at(2) and at(3): at(1) is protected, at(4..6) are the newest three
    expect((await s.listSnapshots("web")).map((x) => x.takenAt)).toEqual([
      at(6),
      at(5),
      at(4),
      at(1),
    ]);
    expect((await s.listSnapshots("mobile")).map((x) => x.id)).toEqual([
      mobile.id,
    ]); // other sources untouched
    expect(await s.listSpecUploads("web")).toHaveLength(1); // upload of the protected snapshot stays
    expect((await s.listSnapshots("web"))[0]!.bytes).toBeGreaterThan(0);
    expect(await s.pruneSnapshots(ws.id, "web", 0)).toEqual([]); // nonsense retention is ignored
  });

  it("cascades deletes", async () => {
    const s = store();
    const ws = await s.createWorkspace({ name: "x" });
    await s.addSource(ws.id, source("web"));
    await s.saveSnapshot(
      ws.id,
      emptySnapshot(
        { sourceId: "web", sourceKind: "console_api", alias: "web" },
        "t",
      ),
    );
    await s.saveCapabilities(ws.id, { capabilities: [] });
    await s.deleteWorkspace(ws.id);
    expect(await s.db.sources.count()).toBe(0);
    expect(await s.db.snapshots.count()).toBe(0);
    expect(await s.getCapabilities(ws.id)).toBeUndefined();
  });

  it("removes one source with its snapshots and ID lists, leaving the others", async () => {
    const s = store();
    const ws = await s.createWorkspace({ name: "x" });
    await s.addSource(ws.id, source("web"));
    await s.addSource(ws.id, source("mobile"));
    await s.saveSnapshot(
      ws.id,
      emptySnapshot(
        { sourceId: "web", sourceKind: "console_api", alias: "web" },
        "t",
      ),
    );
    await s.saveSnapshot(
      ws.id,
      emptySnapshot(
        { sourceId: "mobile", sourceKind: "console_api", alias: "mobile" },
        "t",
      ),
    );
    await s.saveIdList({
      uid: "web:seg",
      workspaceId: ws.id,
      sourceId: "web",
      fetchedAt: "t",
      ids: ["u1"],
    });
    await s.saveIdList({
      uid: "mobile:seg",
      workspaceId: ws.id,
      sourceId: "mobile",
      fetchedAt: "t",
      ids: ["u2"],
    });
    await s.removeSource("web");
    expect((await s.listSources(ws.id)).map((x) => x.id)).toEqual(["mobile"]);
    expect(await s.latestSnapshot("web")).toBeUndefined();
    expect((await s.latestSnapshot("mobile"))?.sourceId).toBe("mobile");
    expect((await s.listIdLists(ws.id)).map((x) => x.uid)).toEqual([
      "mobile:seg",
    ]);
  });

  it("refuses to persist anything that looks like a token", async () => {
    const s = store();
    const ws = await s.createWorkspace({ name: "x" });
    await expect(
      s.addSource(ws.id, { ...source("web"), apiKey: "console-abc" } as never),
    ).rejects.toBeInstanceOf(SecretInStoreError);
    await expect(
      s.updateWorkspace(ws.id, {
        ld: { instance: "us", token: "api-x" } as never,
      }),
    ).rejects.toBeInstanceOf(SecretInStoreError);
    await expect(
      s.saveCapabilities(ws.id, {
        token: { tokenKind: "auth" },
        nested: { accessToken: "x" },
      }),
    ).rejects.toBeInstanceOf(SecretInStoreError);
    expect(() => assertNoSecrets({ token: { tokenKind: "auth" } })).toThrow(); // keys named token are refused, even when nested objects
    expect(() =>
      assertNoSecrets({ tokenInfo: { tokenKind: "auth" }, emptyToken: "" }),
    ).not.toThrow();
  });
});

describe("M3 tables", () => {
  it("keeps resolutions per workspace and refuses secrets in the profile", async () => {
    const { WorkspaceStore, MigratorDb, SecretInStoreError } =
      await import("../src/index.ts");
    const s = new WorkspaceStore(new MigratorDb(`m3-${Math.random()}`));
    await s.saveResolutions("w1", [
      {
        id: "d1",
        type: "client_side_availability",
        optionKey: "both",
        scope: "resource",
        fingerprint: "f",
        decidedAt: "t",
      },
    ]);
    await s.saveResolutions("w2", [
      {
        id: "d1",
        type: "client_side_availability",
        optionKey: "server",
        scope: "resource",
        fingerprint: "f",
        decidedAt: "t",
      },
    ]);
    expect((await s.listResolutions("w1")).map((r) => r.optionKey)).toEqual([
      "both",
    ]);
    await s.deleteResolutions("w1", ["d1"]);
    expect(await s.listResolutions("w1")).toEqual([]);
    await expect(
      s.saveProfile("w1", {
        version: 1,
        sources: {},
        attributes: { token: "x" } as never,
        policies: {},
      }),
    ).rejects.toBeInstanceOf(SecretInStoreError);
  });

  it("lists runs newest first", async () => {
    const { WorkspaceStore, MigratorDb } = await import("../src/index.ts");
    const s = new WorkspaceStore(new MigratorDb(`runs-${Math.random()}`));
    for (const [id, at] of [
      ["a", "2026-01-01"],
      ["b", "2026-02-01"],
    ])
      await s.saveRun({
        id: id!,
        workspaceId: "w",
        projectKey: "p",
        label: id!,
        dryRun: false,
        startedAt: at!,
        status: "done",
        steps: [],
      });
    expect((await s.listRuns("w")).map((r) => r.id)).toEqual(["b", "a"]);
  });
});
