import { ACME_PROJECTS, buildAcmeDataset, SNAPSHOT_COUNT, type AcmeAlias } from './acme/index.ts';
import type { ConsoleProjectDataset } from './console/dataset.ts';
import { generateConfigSpec } from './spec/generate.ts';
import { buildRawIdCsv } from './spec/raw-ids.ts';

export interface AcmeRetailFile {
  schemaVersion: 1;
  name: 'Acme Retail';
  description: string;
  snapshots: number;
  projects: Record<AcmeAlias, ConsoleProjectDataset[]>;
}

export function buildAcmeRetailFile(): AcmeRetailFile {
  const projects = {} as Record<AcmeAlias, ConsoleProjectDataset[]>;
  for (const alias of Object.keys(ACME_PROJECTS) as AcmeAlias[]) {
    projects[alias] = Array.from({ length: SNAPSHOT_COUNT }, (_, i) => buildAcmeDataset(alias, i + 1));
  }
  return {
    schemaVersion: 1,
    name: 'Acme Retail',
    description: 'Seed dataset for demo mode and the main test fixture (PLAN §19). Generated from src/acme; do not edit by hand.',
    snapshots: SNAPSHOT_COUNT,
    projects,
  };
}

/** Minified: these files are generated, collapsed in diffs (.gitattributes), and checked for freshness by a test. */
const json = (v: unknown) => JSON.stringify(v) + '\n';

/** Every committed fixture file, keyed by path relative to the package root. */
export function buildFixtureFiles(): Record<string, string> {
  const files: Record<string, string> = { 'data/acme-retail.json': json(buildAcmeRetailFile()) };
  for (const alias of Object.keys(ACME_PROJECTS) as AcmeAlias[]) {
    const dir = `generated/${ACME_PROJECTS[alias].label}`;
    const s1 = buildAcmeDataset(alias, 1);
    for (const v of [1, 2] as const) files[`${dir}/download_config_specs.v${v}.json`] = json(generateConfigSpec(s1, v).spec);
    // A newer spec for the re-upload diff demo.
    files[`${dir}/download_config_specs.v2.snapshot-2.json`] = json(generateConfigSpec(buildAcmeDataset(alias, 2), 2).spec);
    const g = generateConfigSpec(s1, 2);
    if (Object.keys(g.idListManifest).length) {
      files[`${dir}/get_id_lists.json`] = json(g.idListManifest);
      for (const [name, body] of Object.entries(g.idListFiles)) files[`${dir}/id_lists/${name}`] = body;
    }
  }
  files['generated/acme-web/wholesale_partners.raw-ids.csv'] = buildRawIdCsv(buildAcmeDataset('web', 1), 'wholesale_partners', 0.996);
  return files;
}
