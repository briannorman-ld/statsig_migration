import type {
  AutotuneSeed,
  ConfigSeed,
  ExperimentSeed,
  GateSeed,
  HoldoutSeed,
  IdListSeed,
  JsonObject,
  LayerSeed,
  MetricSeed,
  Person,
  SegmentSeed,
} from '../console/builders.ts';

export interface GateOverrideSeed {
  gate: string;
  passingUserIDs?: string[];
  failingUserIDs?: string[];
  passingCustomIDs?: string[];
  failingCustomIDs?: string[];
  environmentOverrides?: { environment: string | null; unitID: string | null; passingIDs: string[]; failingIDs: string[] }[];
}

export interface ExperimentOverrideSeed {
  experiment: string;
  userIDOverrides: { groupName: string; ids: string[]; environment?: string | null; unitType?: string | null }[];
}

export interface MetricSourceSeed {
  name: string;
  description: string;
  sql: string;
  timestampColumn: string;
  idTypeMapping: { statsigUnitID: string; column: string }[];
  tableName?: string;
  owner: Person;
}

export interface ParamStoreSeed {
  name: string;
  description: string;
  owner: Person;
  parameters: JsonObject[];
}

/** Everything that makes up one demo StatSig project at one point in the timeline. */
export interface ProjectSeed {
  alias: string;
  projectName: string;
  companyName: string;
  isWarehouseNative: boolean;
  environments: { name: string; isProduction: boolean }[];
  unitTypes: { name: string; description: string }[];
  tags: { name: string; description: string; isCore?: boolean }[];
  targetApps: string[];
  teams: string[];
  users: (Person & { role: string })[];
  gates: GateSeed[];
  configs: ConfigSeed[];
  segments: SegmentSeed[];
  experiments: ExperimentSeed[];
  layers: (LayerSeed & { experimentIds: string[] })[];
  holdouts: HoldoutSeed[];
  autotunes: AutotuneSeed[];
  metrics: MetricSeed[];
  metricSources: MetricSourceSeed[];
  paramStores: ParamStoreSeed[];
  gateOverrides: GateOverrideSeed[];
  experimentOverrides: ExperimentOverrideSeed[];
}

export type { IdListSeed };
