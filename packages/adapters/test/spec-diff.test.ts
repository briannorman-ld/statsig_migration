import { describe, expect, it } from 'vitest';
import { buildAcmeDataset, generateConfigSpec } from '@sslm/demo-fixtures';
import { checkUpload, diffSnapshots } from '@sslm/canonical';
import { classifySpec, normalizeSpec } from '../src/index.ts';

const snap = (snapshot: number, mutate?: (spec: Record<string, any>) => void) => {
  const { spec } = generateConfigSpec(buildAcmeDataset('web', snapshot), 2);
  const json = JSON.parse(JSON.stringify(spec));
  mutate?.(json);
  return normalizeSpec(classifySpec(json), { source: { sourceId: 'web-spec', sourceKind: 'config_spec', alias: 'web' }, takenAt: `t${snapshot}` });
};

describe('spec re-upload diffing and sanity checks (PLAN §4.2)', () => {
  it('diffs snapshot 1 → 2 down to the environments whose targeting changed', () => {
    const d = diffSnapshots(snap(1), snap(2), ['development', 'staging', 'production', 'qa']);
    const byId = Object.fromEntries(d.changed.map((c) => [`${c.kind}/${c.id}`, c]));
    expect(Object.keys(byId).sort()).toEqual(['config/shipping_thresholds', 'experiment/search_ranking_v3', 'gate/dark_mode', 'gate/new_checkout_flow']);
    expect(byId['gate/new_checkout_flow']!.targetingChangedIn).toEqual(['development', 'staging', 'production', 'qa']);
    expect(byId['experiment/search_ranking_v3']!.otherChanged).toBe(true);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('dedupes uploads where only `time` changed', () => {
    const a = snap(1);
    const b = snap(1, (s) => (s.time = s.time + 60_000));
    expect(checkUpload(a, b).duplicate).toBe(true);
    expect(diffSnapshots(a, b).onlyTimeChanged).toBe(true);
  });

  it('flags a different company and disappeared entities', () => {
    const a = snap(1);
    const b = snap(1, (s) => {
      s.company_id = 'someone-else';
      delete s.feature_gates['dark_mode'];
    });
    const r = checkUpload(a, b);
    expect(r.companyMismatch).toEqual({ previous: a.companyId, next: 'someone-else' });
    expect(r.disappeared).toEqual([{ kind: 'gate', id: 'dark_mode' }]);
  });
});
