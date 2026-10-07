import { expandIdList } from '../console/builders.ts';
import type { ConsoleProjectDataset } from '../console/dataset.ts';

/**
 * A raw-ID CSV for an ID-list segment, for the reconciliation demo (PLAN §4.2, §19.2): it omits
 * a deterministic slice of IDs so coverage is `coverage` (e.g. 0.996 → "99.6% matched").
 */
export function buildRawIdCsv(d: ConsoleProjectDataset, segmentId: string, coverage: number): string {
  const seed = d.idLists[segmentId];
  if (!seed) throw new Error(`no ID list for ${segmentId}`);
  const ids = expandIdList(seed);
  const drop = Math.round(ids.length * (1 - coverage));
  const step = drop > 0 ? Math.floor(ids.length / drop) : Infinity;
  const kept = ids.filter((_, i) => !(drop > 0 && i % step === step - 1 && Math.floor(i / step) < drop));
  return ['id', ...kept].join('\n') + '\n';
}
