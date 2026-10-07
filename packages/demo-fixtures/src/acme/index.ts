import { buildConsoleDataset, type ConsoleProjectDataset } from '../console/dataset.ts';
import { acmeMobile } from './mobile.ts';
import { SNAPSHOT_1_NOW, SNAPSHOT_STEP } from './people.ts';
import type { ProjectSeed } from './seed-types.ts';
import { applyTimeline, SNAPSHOT_COUNT } from './timeline.ts';
import { acmeWeb } from './web.ts';

export { SNAPSHOT_COUNT } from './timeline.ts';
export { PEOPLE, SNAPSHOT_1_NOW } from './people.ts';
export type { ProjectSeed } from './seed-types.ts';

export type AcmeAlias = 'web' | 'mobile';

/** The two demo StatSig projects (PLAN §19.2). */
export const ACME_PROJECTS: Record<AcmeAlias, { label: string; seed: () => ProjectSeed }> = {
  web: { label: 'acme-web', seed: acmeWeb },
  mobile: { label: 'acme-mobile', seed: acmeMobile },
};

export function acmeSeed(alias: AcmeAlias, snapshot = 1): ProjectSeed {
  if (snapshot < 1 || snapshot > SNAPSHOT_COUNT) throw new Error(`snapshot must be 1..${SNAPSHOT_COUNT}`);
  return applyTimeline(ACME_PROJECTS[alias].seed(), snapshot);
}

export function snapshotTime(snapshot: number): number {
  return SNAPSHOT_1_NOW + (snapshot - 1) * SNAPSHOT_STEP;
}

/** Build the Console API dataset for one Acme project at one snapshot. Deterministic. */
export function buildAcmeDataset(alias: AcmeAlias, snapshot = 1): ConsoleProjectDataset {
  return buildConsoleDataset(acmeSeed(alias, snapshot), snapshot, snapshotTime(snapshot));
}
