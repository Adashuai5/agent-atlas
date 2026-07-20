import type { AssetType, Owner, Scope } from "./classify.ts";

export const ATLAS_GRAPH_SCHEMA_VERSION = 2 as const;

export type AtlasGraphSchemaVersion = typeof ATLAS_GRAPH_SCHEMA_VERSION;
export type EvidenceId = string;
export type CanonicalSourceId = string;
export type InstallationId = string;
export type InstallationLocationId = string;
export type RuntimeConsumerId = string;
export type BindingId = string;
export type PluginPackageId = string;
export type DiagnosisId = string;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type EvidenceKind =
  | "filesystem"
  | "symlink"
  | "content-hash"
  | "skill-lock"
  | "manifest"
  | "configuration"
  | "runtime"
  | "process"
  | "session"
  | "inference";

export interface Evidence {
  id: EvidenceId;
  kind: EvidenceKind;
  source: string;
  path: string | null;
  observedAt: string;
  detail: string;
  attributes?: Record<string, JsonValue>;
}

/** Unknown is explicit: absence of evidence must never be rendered as false. */
export type TriState = true | false | "unknown";
export type AssessmentConfidence = "confirmed" | "inferred" | "unknown";

export interface StateAssessment {
  value: TriState;
  confidence: AssessmentConfidence;
  evidenceIds: EvidenceId[];
  reason: string | null;
}

export type ContentHashAlgorithm = "sha256-file-v1" | "sha256-normalized-directory-v1";

/** Raw filesystem facts. Semantic resource validity is assessed separately. */
export interface PathIdentity {
  present: boolean;
  valid: boolean;
  isSymlink: boolean;
  linkTarget: string | null;
  realpath: string | null;
  device: string | null;
  inode: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  contentHash: string | null;
  hashAlgorithm: ContentHashAlgorithm | null;
}

export interface CanonicalSource {
  id: CanonicalSourceId;
  name: string;
  type: AssetType;
  sourceType: string | null;
  source: string | null;
  sourceUrl: string | null;
  sourcePath: string | null;
  revision: string | null;
  expectedContentHash: string | null;
  expectedHashAlgorithm: string | null;
  confidence: AssessmentConfidence;
  evidenceIds: EvidenceId[];
}

export type InstallationLocationKind = "primary" | "alias" | "symlink";

export interface InstallationLocation extends PathIdentity {
  id: InstallationLocationId;
  path: string;
  kind: InstallationLocationKind;
  storageOwner: Owner;
  scope: Scope;
  projectPath: string | null;
  evidenceIds: EvidenceId[];
}

export interface Installation {
  id: InstallationId;
  canonicalSourceId: CanonicalSourceId | null;
  pluginPackageId: PluginPackageId | null;
  name: string;
  type: AssetType;
  role: "primary" | "mirror";
  storageOwner: Owner;
  physicalId: string | null;
  contentHash: string | null;
  hashAlgorithm: ContentHashAlgorithm | null;
  present: StateAssessment;
  valid: StateAssessment;
  locations: InstallationLocation[];
  evidenceIds: EvidenceId[];
}

export interface RuntimeConsumer {
  id: RuntimeConsumerId;
  runtime: Owner;
  label: string;
  version: string | null;
  scope: Scope;
  projectPath: string | null;
  configPaths: string[];
  evidenceIds: EvidenceId[];
}

export type BindingDiscovery =
  | "default-root"
  | "project-root"
  | "external-dir"
  | "configuration"
  | "plugin"
  | "runtime-observation"
  | "unknown";

export type BindingVisibility = "visible" | "shadowed" | "unknown";

export interface Binding {
  id: BindingId;
  installationId: InstallationId;
  consumerId: RuntimeConsumerId;
  viaLocationId: InstallationLocationId | null;
  viaPath: string;
  scope: Scope;
  projectPath: string | null;
  discovery: BindingDiscovery;
  priority: number | null;
  visibility: BindingVisibility;
  shadowedByBindingId: BindingId | null;
  enabled: StateAssessment;
  loaded: StateAssessment;
  evidenceIds: EvidenceId[];
}

export type PluginPackageKind = "bundled" | "marketplace" | "installed" | "cache" | "source" | "unknown";

export interface PluginPackage {
  id: PluginPackageId;
  name: string;
  version: string | null;
  kind: PluginPackageKind;
  storageOwner: Owner;
  manifestPath: string;
  installationId: InstallationId | null;
  consumerIds: RuntimeConsumerId[];
  componentInstallationIds: InstallationId[];
  bundled: StateAssessment;
  installed: StateAssessment;
  enabled: StateAssessment;
  loaded: StateAssessment;
  evidenceIds: EvidenceId[];
}

export type DiagnosisKind = "alias" | "mirror" | "redundant" | "conflict" | "invalid" | "uncertain";
export type DiagnosisSeverity = "healthy" | "info" | "attention" | "warning";

export interface Diagnosis {
  id: DiagnosisId;
  kind: DiagnosisKind;
  severity: DiagnosisSeverity;
  confidence: AssessmentConfidence;
  consumerId: RuntimeConsumerId | null;
  canonicalSourceIds: CanonicalSourceId[];
  installationIds: InstallationId[];
  bindingIds: BindingId[];
  pluginPackageIds: PluginPackageId[];
  title: string;
  titleEn: string;
  detail: string;
  detailEn: string;
  action: string;
  actionEn: string;
  evidenceIds: EvidenceId[];
}

/** References attached to a legacy Asset while renderers migrate to the graph. */
export interface AssetIdentityReferences {
  canonicalSourceId: CanonicalSourceId | null;
  installationId: InstallationId | null;
  locationId: InstallationLocationId | null;
  bindingIds: BindingId[];
  pluginPackageId: PluginPackageId | null;
}

export interface AtlasResourceGraph {
  schemaVersion: AtlasGraphSchemaVersion;
  generatedAt: string;
  evidence: Evidence[];
  canonicalSources: CanonicalSource[];
  installations: Installation[];
  consumers: RuntimeConsumer[];
  bindings: Binding[];
  pluginPackages: PluginPackage[];
  diagnoses: Diagnosis[];
}
