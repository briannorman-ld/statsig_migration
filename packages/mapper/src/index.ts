/**
 * The mapper (M3): pure and deterministic (CLAUDE.md, PLAN §8.1).
 *
 *   map(canonical, profile, resolutions, capabilities, env) → { desired, fidelity, unresolved }
 *
 * Only the contract is declared so far; the implementation and golden tests arrive in M3, using
 * packages/demo-fixtures as the main fixture.
 */
import type { Config, Gate, Segment } from '@sslm/canonical';

export type Mappable = Gate | Config | Segment;

export interface MapArgs<Profile, Resolutions, Capabilities> {
  entity: Mappable;
  profile: Profile;
  resolutions: Resolutions;
  capabilities: Capabilities;
  /** StatSig environment / tier being migrated. */
  env: string;
}

export interface MapResult<Desired, Fidelity, DecisionPoint> {
  desired: Desired;
  fidelity: Fidelity;
  unresolved: DecisionPoint[];
}
