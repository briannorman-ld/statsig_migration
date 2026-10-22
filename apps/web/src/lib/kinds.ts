import type { EntityKind } from '@sslm/canonical';

export const KIND_LABEL: Record<EntityKind, string> = {
  gate: 'Gates',
  config: 'Dynamic configs',
  segment: 'Segments',
  experiment: 'Experiments',
  layer: 'Layers',
  holdout: 'Holdouts',
  autotune: 'Autotunes',
  metric: 'Metrics',
  param_store: 'Param stores',
};

/** Human list of a source's crawl scope, e.g. "Gates, Segments"; empty when it reads everything. */
export function describeScope(resources: EntityKind[] | undefined): string {
  return resources ? resources.map((k) => KIND_LABEL[k]).join(', ') : '';
}
