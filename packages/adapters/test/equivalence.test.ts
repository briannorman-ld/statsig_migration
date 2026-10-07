import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildAcmeDataset, generateConfigSpec, type AcmeAlias } from '@sslm/demo-fixtures';
import { effectiveTargeting, type CanonicalSnapshot, type Entity } from '@sslm/canonical';
import { classifySpec, crawlConsoleProject, normalizeConsoleSnapshot, normalizeSpec, parseSpecBytes } from '../src/index.ts';
import { mockProject, server, testClient } from './msw-server.ts';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function viaConsole(alias: AcmeAlias, snapshot: number): Promise<CanonicalSnapshot> {
  mockProject(alias, { dataset: buildAcmeDataset(alias, snapshot) });
  const { client, issues } = testClient(alias);
  const raw = await crawlConsoleProject(client, issues, { eagerIdListMax: 1000 });
  return normalizeConsoleSnapshot(raw, { source: { sourceId: alias, sourceKind: 'console_api', alias }, takenAt: 't' });
}

function viaSpec(alias: AcmeAlias, snapshot: number, version: 1 | 2): CanonicalSnapshot {
  const { spec } = generateConfigSpec(buildAcmeDataset(alias, snapshot), version);
  return normalizeSpec(classifySpec(JSON.parse(JSON.stringify(spec))), { source: { sourceId: alias, sourceKind: 'config_spec', alias }, takenAt: 't' });
}

const live = <T extends Entity>(xs: T[]) => xs.filter((x) => !x.archived);
const byId = <T extends Entity>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

const CASES = (['web', 'mobile'] as const).flatMap((alias) => [1, 2].flatMap((snapshot) => ([1, 2] as const).map((v) => [alias, snapshot, v] as const)));

describe('adapter equivalence: Console API path vs config-spec path (PLAN §16)', () => {
  it.each(CASES)('%s snapshot %i, spec v%i: same canonical targeting in every environment', async (alias, snapshot, version) => {
    const api = await viaConsole(alias, snapshot);
    const spec = viaSpec(alias, snapshot, version);
    const envs = api.environments.map((e) => e.name);

    // Environments inferred from the spec are a subset of the real list (§4.2: user confirms).
    expect(envs).toEqual(expect.arrayContaining(spec.environments.map((e) => e.name)));
    expect(spec.unitTypes.map((u) => u.name).sort()).toEqual(expect.arrayContaining(['userID']));

    for (const kind of ['gates', 'configs', 'segments'] as const) {
      const a = live(api[kind] as Entity[]) as (typeof api)[typeof kind];
      const s = byId(spec[kind] as Entity[]);
      expect([...s.keys()].sort(), kind).toEqual(a.map((x) => x.id).sort());
      for (const ent of a) {
        const other = s.get(ent.id)! as typeof ent;
        for (const env of envs) {
          expect(effectiveTargeting(other, env), `${kind}/${ent.id} @ ${env}`).toEqual(effectiveTargeting(ent, env));
        }
        expect(other.idType.toLowerCase(), `${ent.id} idType`).toBe(ent.idType.toLowerCase());
      }
    }

    // ID lists: plaintext where the spec inlines them, hashed otherwise.
    for (const seg of api.segments.filter((x) => x.segmentType === 'id_list')) {
      const other = spec.segments.find((x) => x.id === seg.id)!;
      if (seg.idList?.ids) expect(other.idList?.ids, seg.id).toEqual(seg.idList.ids);
      else expect(other.idList?.hashed?.listName, seg.id).toBe(seg.id);
    }

    // Gate holdouts.
    for (const g of live(api.gates)) expect(spec.gates.find((x) => x.id === g.id)!.holdoutIds, g.id).toEqual(g.holdoutIds);
    for (const h of api.holdouts) {
      const other = spec.holdouts.find((x) => x.id === h.id)!;
      expect(other.passPercentage).toBe(h.passPercentage);
      expect(other.gateIds.sort()).toEqual([...h.gateIds].sort());
    }

    // Experiments: the spec carries status, allocation, layer, targeting, launched group, and
    // groups only while running.
    for (const e of live(api.experiments)) {
      const other = spec.experiments.find((x) => x.id === e.id)!;
      const launchedName = e.groups.find((g) => g.id === e.launchedGroupId)?.name ?? null;
      expect({ status: other.status, allocation: other.allocation, layerId: other.layerId, targetingGateId: other.targetingGateId, launched: other.launchedGroupId }, e.id).toEqual({
        status: e.status,
        allocation: e.allocation,
        layerId: e.layerId,
        targetingGateId: e.targetingGateId,
        launched: launchedName,
      });
      if (e.status === 'active') {
        expect(other.groups.map((g) => [g.name, g.size, g.parameterValues])).toEqual(e.groups.map((g) => [g.name, g.size, g.parameterValues]));
      }
      expect(other.overrides.map((o) => [o.unitType, o.ids, o.value.kind === 'group' ? o.value.groupName : null])).toEqual(
        e.overrides.map((o) => [o.unitType, o.ids, o.value.kind === 'group' ? o.value.groupName : null]),
      );
    }

    for (const l of api.layers) {
      const other = spec.layers.find((x) => x.id === l.id)!;
      expect(other.experimentIds.sort()).toEqual([...l.experimentIds].sort());
      expect(Object.fromEntries(other.parameters.map((p) => [p.name, p.defaultValue]))).toEqual(Object.fromEntries(l.parameters.map((p) => [p.name, p.defaultValue])));
    }
    for (const a of api.autotunes) expect(spec.autotunes.find((x) => x.id === a.id)!.variants.map((v) => [v.name, v.json])).toEqual(a.variants.map((v) => [v.name, v.json]));
    if (version === 2) {
      for (const p of api.paramStores) {
        expect(spec.paramStores.find((x) => x.id === p.id)!.parameters.map((x) => [x.name, x.refType, x.ref, x.value])).toEqual(p.parameters.map((x) => [x.name, x.refType, x.ref, x.value]));
      }
    }

    // Nothing the generator emits is unrecognized by the parser.
    expect(spec.warnings.filter((w) => w.code !== 'partial_spec')).toEqual([]);
  });

  it('the committed sample spec files parse to the same snapshot as freshly generated ones', async () => {
    const path = fileURLToPath(new URL('../../demo-fixtures/generated/acme-web/download_config_specs.v2.json', import.meta.url));
    const fromFile = normalizeSpec(await parseSpecBytes(new Uint8Array(readFileSync(path)), 'download_config_specs.v2.json'), { source: { sourceId: 'web', sourceKind: 'config_spec', alias: 'web' }, takenAt: 't' });
    expect(fromFile).toEqual(viaSpec('web', 1, 2));
  });
});
