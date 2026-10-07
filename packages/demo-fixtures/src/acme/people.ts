import { pseudoId } from '../ids.ts';
import type { Person } from '../console/builders.ts';

const person = (name: string, email: string): Person => ({ id: pseudoId(`person/${email}`), name, email });

/**
 * Acme Retail staff. Emails use the reserved `.example` TLD. Some owners are meant to be missing
 * from the LD account, to trigger `maintainer_unknown` (PLAN §19.2).
 */
export const PEOPLE = {
  alice: person('Alice Chen', 'alice.chen@acmeretail.example'),
  bob: person('Bob Okafor', 'bob.okafor@acmeretail.example'),
  priya: person('Priya Raman', 'priya.raman@acmeretail.example'),
  marco: person('Marco Rossi', 'marco.rossi@acmeretail.example'),
  dana: person('Dana Kim', 'dana.kim@acmeretail.example'),
  sam: person('Sam Taylor', 'sam.taylor@acmeretail.example'),
  // Left Acme; never in LD.
  former: person('Jordan Former', 'jordan.former@acmeretail.example'),
} as const;

export const DAY = 86_400_000;
/** "Now" for snapshot 1 of the demo timeline. Snapshot 2 is a week later. */
export const SNAPSHOT_1_NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
export const SNAPSHOT_STEP = 7 * DAY;

/** A time in the past (holiday sale ended), and one far in the future (next Black Friday). */
export const PAST_START = Date.UTC(2025, 10, 20);
export const PAST_END = Date.UTC(2026, 0, 5);
export const FUTURE_START = Date.UTC(2027, 10, 26, 5, 0, 0);
export const LAUNCH_DAY = Date.UTC(2024, 2, 14);
