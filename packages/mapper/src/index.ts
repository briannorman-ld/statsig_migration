/**
 * The mapper (M3): pure and deterministic (CLAUDE.md, PLAN §8.1).
 *
 *   map(canonical, profile, resolutions, capabilities, env) → { desired, fidelity, unresolved }
 *
 * `mapGate` and `mapSegment` take those inputs as one object (plus `now`, because StatSig `time`
 * conditions compare the current time). Golden tests use packages/demo-fixtures.
 */
export * from './types.ts';
export * from './profile.ts';
export * from './decisions.ts';
export { caseFoldedPattern, toTimestamp, LIST_SEGMENT_MAX } from './conditions.ts';
export { mapGate, TAG_MIGRATED, sourceTag, PASS, FAIL, type GateMapResult, type MapArgs, type MapOutcome } from './gate.ts';
export { mapSegment, type SegmentMapResult } from './segment.ts';
