import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, Owner, Scope } from "../src/classify.ts";
import { buildSnapshot } from "../src/diagnose.ts";
import type { Atlas } from "../src/scan.ts";
import type {
  Binding,
  CanonicalSource,
  Installation,
  InstallationLocation,
  RuntimeConsumer,
  StateAssessment,
  TriState
} from "../src/model.ts";

const GENERATED_AT = "2026-07-17T00:00:00.000Z";
type RuntimeName = Extract<Owner, "codex" | "claude" | "hermes">;

function assessment(value: TriState): StateAssessment {
  return {
    value,
    confidence: value === "unknown" ? "unknown" : "confirmed",
    evidenceIds: [],
    reason: value === "unknown" ? "No direct evidence." : null
  };
}

interface InstallationOptions {
  name?: string;
  hash?: string | null;
  canonicalSourceId?: string | null;
  valid?: boolean;
  owner?: Owner;
  scope?: Scope;
  locationCount?: number;
}

function installation(id: string, options: InstallationOptions = {}): Installation {
  const name = options.name ?? "shared-skill";
  const hash = options.hash === undefined ? `hash-${id}` : options.hash;
  const owner = options.owner ?? "agents";
  const scope = options.scope ?? "global";
  const locationCount = options.locationCount ?? 1;
  const locations: InstallationLocation[] = Array.from({ length: locationCount }, (_, index) => ({
    id: `location:${id}:${index}`,
    path: index === 0 ? `/storage/${id}/${name}` : `/aliases/${id}/${index}/${name}`,
    kind: index === 0 ? "primary" : "alias",
    storageOwner: owner,
    scope,
    projectPath: null,
    present: true,
    valid: options.valid ?? true,
    isSymlink: index > 0,
    linkTarget: index > 0 ? `/storage/${id}/${name}` : null,
    realpath: `/storage/${id}/${name}`,
    device: "1",
    inode: id,
    sizeBytes: 1,
    modifiedAt: GENERATED_AT,
    contentHash: hash,
    hashAlgorithm: hash ? "sha256-normalized-directory-v1" : null,
    evidenceIds: []
  }));

  return {
    id,
    canonicalSourceId: options.canonicalSourceId ?? null,
    pluginPackageId: null,
    name,
    type: "skill",
    role: "primary",
    storageOwner: owner,
    physicalId: `1:${id}`,
    contentHash: hash,
    hashAlgorithm: hash ? "sha256-normalized-directory-v1" : null,
    present: assessment(true),
    valid: assessment(options.valid ?? true),
    locations,
    evidenceIds: []
  };
}

function consumer(id: string, runtime: RuntimeName): RuntimeConsumer {
  return {
    id,
    runtime,
    label: runtime === "codex" ? "Codex" : runtime === "claude" ? "Claude" : "Hermes",
    version: null,
    scope: "global",
    projectPath: null,
    configPaths: [],
    evidenceIds: []
  };
}

interface BindingOptions {
  exposedName?: string;
  enabled?: TriState;
  loaded?: TriState;
  visibility?: Binding["visibility"];
  shadowedByBindingId?: string | null;
  priority?: number;
}

function binding(
  id: string,
  installationId: string,
  consumerId: string,
  options: BindingOptions = {}
): Binding {
  return {
    id,
    installationId,
    consumerId,
    viaLocationId: `location:${installationId}:0`,
    viaPath: `/visible/${options.exposedName ?? "shared-skill"}`,
    scope: "global",
    projectPath: null,
    discovery: "default-root",
    priority: options.priority ?? 100,
    visibility: options.visibility ?? "visible",
    shadowedByBindingId: options.shadowedByBindingId ?? null,
    enabled: assessment(options.enabled ?? "unknown"),
    loaded: assessment(options.loaded ?? "unknown"),
    evidenceIds: []
  };
}

function asset(source: Installation, bindingIds: string[]): Asset {
  const location = source.locations[0]!;
  return {
    id: `asset:${source.id}`,
    name: source.name,
    type: source.type,
    owner: source.storageOwner,
    placementOwner: source.storageOwner,
    scope: location.scope,
    path: location.path,
    projectPath: null,
    sizeBytes: 1,
    modifiedAt: GENERATED_AT,
    signals: { isDirectory: true, hasSkillMd: true },
    identity: {
      present: location.present,
      valid: location.valid,
      isSymlink: location.isSymlink,
      linkTarget: location.linkTarget,
      realpath: location.realpath,
      device: location.device,
      inode: location.inode,
      sizeBytes: location.sizeBytes,
      modifiedAt: location.modifiedAt,
      contentHash: location.contentHash,
      hashAlgorithm: location.hashAlgorithm
    },
    states: {
      present: source.present,
      valid: source.valid
    },
    graph: {
      canonicalSourceId: source.canonicalSourceId,
      installationId: source.id,
      locationId: location.id,
      bindingIds,
      pluginPackageId: null
    }
  };
}

function canonicalSource(id: string, name = "shared-skill"): CanonicalSource {
  return {
    id,
    name,
    type: "skill",
    sourceType: null,
    source: null,
    sourceUrl: null,
    sourcePath: null,
    revision: null,
    expectedContentHash: null,
    expectedHashAlgorithm: null,
    confidence: "unknown",
    evidenceIds: []
  };
}

function atlasGraph(input: {
  installations: Installation[];
  consumers?: RuntimeConsumer[];
  bindings?: Binding[];
  assets?: Asset[];
  canonicalSources?: CanonicalSource[];
}): Atlas {
  const consumers = input.consumers ?? [];
  const bindings = input.bindings ?? [];
  const assets = input.assets ?? [];
  const canonicalSources = input.canonicalSources ?? [];
  return {
    schemaVersion: 2,
    generatedAt: GENERATED_AT,
    computer: { hostname: "fixture-host", home: "/fixture-home" },
    warnings: [],
    evidence: [],
    canonicalSources,
    installations: input.installations,
    consumers,
    bindings,
    pluginPackages: [],
    diagnoses: [],
    agents: [],
    projects: [],
    assets,
    summary: {
      assetCount: assets.length,
      canonicalSourceCount: canonicalSources.length,
      installationCount: input.installations.length,
      bindingCount: bindings.length,
      pluginCount: 0,
      byType: {},
      byOwner: {},
      byScope: {}
    }
  };
}

test("a shadowed binding remains inventory and is not effective", () => {
  const stored = installation("shadowed");
  const codex = consumer("consumer:codex", "codex");
  const shadowed = binding("binding:shadowed", stored.id, codex.id, {
    enabled: true,
    visibility: "shadowed",
    shadowedByBindingId: "binding:winner"
  });
  const snapshot = buildSnapshot(atlasGraph({
    installations: [stored],
    consumers: [codex],
    bindings: [shadowed],
    assets: [asset(stored, [shadowed.id])]
  }), null);

  const row = snapshot.resources.find((resource) => resource.bindingId === shadowed.id);
  assert.ok(row);
  assert.equal(row.visible, false);
  assert.equal(row.effective, false);
  assert.equal(snapshot.systems.some((system) => system.consumer === "codex"), false);
});

test("visible binding with unknown enabled state enters the resource surface without coercion", () => {
  const stored = installation("unknown-enabled");
  const codex = consumer("consumer:codex", "codex");
  const visible = binding("binding:visible", stored.id, codex.id, {
    enabled: "unknown",
    loaded: "unknown",
    visibility: "visible"
  });
  const snapshot = buildSnapshot(atlasGraph({
    installations: [stored],
    consumers: [codex],
    bindings: [visible],
    assets: [asset(stored, [visible.id])]
  }), null);

  const row = snapshot.resources.find((resource) => resource.bindingId === visible.id);
  assert.ok(row);
  assert.equal(row.visible, true);
  assert.equal(row.effective, true);
  assert.equal(row.states.enabled.value, "unknown");
  assert.equal(row.states.loaded.value, "unknown");
  assert.equal(snapshot.stats.effective, 1);
  assert.equal(snapshot.stats.enabled, 0);
  assert.equal(snapshot.systems.find((system) => system.consumer === "codex")?.resources, 1);
});

test("an explicitly disabled binding remains distinct from missing binding evidence", () => {
  const stored = installation("explicitly-disabled");
  const hermes = consumer("consumer:hermes", "hermes");
  const disabled = binding("binding:disabled", stored.id, hermes.id, { enabled: false });
  const snapshot = buildSnapshot(atlasGraph({
    installations: [stored],
    consumers: [hermes],
    bindings: [disabled],
    assets: [asset(stored, [disabled.id])]
  }), null);

  const row = snapshot.resources.find((resource) => resource.bindingId === disabled.id);
  assert.ok(row);
  assert.equal(row.effective, false);
  assert.equal(row.states.enabled.value, false);
  assert.match(row.reason, /配置明确将其禁用/);
  assert.match(row.reasonEn, /configuration explicitly disables it/);
});

test("a Codex conflict does not contaminate the Claude row or Claude system for a shared installation", () => {
  const shared = installation("shared", { hash: "hash-a" });
  const divergent = installation("divergent", { hash: "hash-b" });
  const codex = consumer("consumer:codex", "codex");
  const claude = consumer("consumer:claude", "claude");
  const codexShared = binding("binding:codex-shared", shared.id, codex.id);
  const claudeShared = binding("binding:claude-shared", shared.id, claude.id);
  const codexDivergent = binding("binding:codex-divergent", divergent.id, codex.id);
  const snapshot = buildSnapshot(atlasGraph({
    installations: [shared, divergent],
    consumers: [codex, claude],
    bindings: [codexShared, claudeShared, codexDivergent],
    assets: [
      asset(shared, [codexShared.id, claudeShared.id]),
      asset(divergent, [codexDivergent.id])
    ]
  }), null);

  assert.ok(snapshot.diagnoses.some((diagnosis) => diagnosis.kind === "conflict" && diagnosis.consumerId === codex.id));
  const codexRow = snapshot.resources.find((resource) => resource.bindingId === codexShared.id);
  const claudeRow = snapshot.resources.find((resource) => resource.bindingId === claudeShared.id);
  assert.ok(codexRow);
  assert.ok(claudeRow);
  assert.equal(codexRow.diagnosisKinds.includes("conflict"), true);
  assert.equal(codexRow.health, "warning");
  assert.equal(claudeRow.diagnosisKinds.includes("conflict"), false);
  assert.notEqual(claudeRow.health, "warning");
  assert.notEqual(snapshot.systems.find((system) => system.consumer === "claude")?.health, "warning");
  const conflict = snapshot.diagnoses.find((diagnosis) => diagnosis.kind === "conflict");
  assert.ok(conflict);
  const conflictIssue = snapshot.issues.find((issue) => issue.id === conflict.id);
  assert.ok(conflictIssue);
  assert.deepEqual(
    new Set(conflictIssue.assetIds),
    new Set(snapshot.resources.filter((resource) => [codexShared.id, codexDivergent.id].includes(resource.bindingId ?? "")).map((resource) => resource.id))
  );
  assert.equal(conflictIssue.assetIds.includes(claudeRow.id), false);
});

test("an invalid attention diagnosis makes the scope conclusion attention", () => {
  const invalid = installation("invalid", { valid: false });
  const snapshot = buildSnapshot(atlasGraph({
    installations: [invalid],
    assets: [asset(invalid, [])]
  }), null);

  const invalidDiagnosis = snapshot.diagnoses.find((diagnosis) => diagnosis.kind === "invalid");
  assert.ok(invalidDiagnosis);
  assert.equal(invalidDiagnosis.severity, "attention");
  assert.equal(snapshot.issues.find((issue) => issue.id === invalidDiagnosis.id)?.severity, "attention");
  assert.equal(snapshot.conclusion.health, "attention");
});

test("an unbound null-hash installation is excluded from a confirmed mirror relation", () => {
  const sourceId = "canonical:shared";
  const codexCopy = installation("codex-copy", { hash: "same-hash", canonicalSourceId: sourceId });
  const claudeCopy = installation("claude-copy", { hash: "same-hash", canonicalSourceId: sourceId });
  const unboundUnknown = installation("unbound-unknown", { hash: null, canonicalSourceId: sourceId });
  const codex = consumer("consumer:codex", "codex");
  const claude = consumer("consumer:claude", "claude");
  const codexBinding = binding("binding:codex", codexCopy.id, codex.id);
  const claudeBinding = binding("binding:claude", claudeCopy.id, claude.id);
  const snapshot = buildSnapshot(atlasGraph({
    installations: [codexCopy, claudeCopy, unboundUnknown],
    consumers: [codex, claude],
    bindings: [codexBinding, claudeBinding],
    assets: [
      asset(codexCopy, [codexBinding.id]),
      asset(claudeCopy, [claudeBinding.id]),
      asset(unboundUnknown, [])
    ],
    canonicalSources: [canonicalSource(sourceId)]
  }), null);

  const mirror = snapshot.diagnoses.find((diagnosis) => diagnosis.kind === "mirror");
  assert.ok(mirror);
  assert.equal(mirror.confidence, "confirmed");
  assert.deepEqual(new Set(mirror.installationIds), new Set([codexCopy.id, claudeCopy.id]));
  assert.equal(mirror.installationIds.includes(unboundUnknown.id), false);
});

test("alias diagnosis retains healthy severity in the Issue projection", () => {
  const aliased = installation("aliased", { locationCount: 2 });
  const snapshot = buildSnapshot(atlasGraph({
    installations: [aliased],
    assets: [asset(aliased, [])]
  }), null);

  const aliasDiagnosis = snapshot.diagnoses.find((diagnosis) => diagnosis.kind === "alias");
  assert.ok(aliasDiagnosis);
  assert.equal(aliasDiagnosis.severity, "healthy");
  assert.equal(snapshot.issues.find((issue) => issue.id === aliasDiagnosis.id)?.severity, "healthy");
  assert.equal(snapshot.conclusion.health, "healthy");
});

test("same-hash bindings with unknown loaded state are uncertain rather than redundant", () => {
  const first = installation("first", { hash: "same-hash" });
  const second = installation("second", { hash: "same-hash" });
  const codex = consumer("consumer:codex", "codex");
  const firstBinding = binding("binding:first", first.id, codex.id, { loaded: "unknown" });
  const secondBinding = binding("binding:second", second.id, codex.id, { loaded: "unknown" });
  const snapshot = buildSnapshot(atlasGraph({
    installations: [first, second],
    consumers: [codex],
    bindings: [firstBinding, secondBinding],
    assets: [asset(first, [firstBinding.id]), asset(second, [secondBinding.id])]
  }), null);

  assert.equal(snapshot.diagnoses.some((diagnosis) => diagnosis.kind === "redundant"), false);
  const uncertain = snapshot.diagnoses.find((diagnosis) => diagnosis.kind === "uncertain");
  assert.ok(uncertain);
  assert.equal(uncertain.severity, "info");
  assert.equal(uncertain.confidence, "unknown");
});

test("project snapshot excludes inventory owned by other project scopes", () => {
  const selectedInstallation = installation("selected-project", { scope: "project" });
  const otherInstallation = installation("other-project", { scope: "project" });
  const selectedAsset = asset(selectedInstallation, []);
  const otherAsset = asset(otherInstallation, []);
  selectedAsset.scope = "project";
  selectedAsset.projectPath = "/projects/selected";
  otherAsset.scope = "project";
  otherAsset.projectPath = "/projects/other";
  const atlas = atlasGraph({
    installations: [selectedInstallation, otherInstallation],
    assets: [selectedAsset, otherAsset]
  });
  atlas.projects = [selectedAsset, otherAsset];

  const snapshot = buildSnapshot(atlas, "/projects/selected");

  assert.equal(snapshot.project?.path, "/projects/selected");
  assert.ok(snapshot.resources.some((resource) => resource.assetId === selectedAsset.id));
  assert.equal(snapshot.resources.some((resource) => resource.assetId === otherAsset.id), false);
});
