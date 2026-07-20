import assert from "node:assert/strict";
import { test } from "node:test";
import type { Owner, Scope } from "../src/classify.ts";
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
import { evaluateDiagnoses } from "../src/relations.ts";

const GENERATED_AT = "2026-07-17T00:00:00.000Z";

function assessment(value: TriState): StateAssessment {
  return {
    value,
    confidence: value === "unknown" ? "unknown" : "confirmed",
    evidenceIds: [],
    reason: null
  };
}

interface InstallationOptions {
  name?: string;
  hash?: string;
  canonicalSourceId?: string | null;
  physicalId?: string;
  owner?: Owner;
  scope?: Scope;
  projectPath?: string | null;
  locationCount?: number;
}

function installation(id: string, options: InstallationOptions = {}): Installation {
  const name = options.name ?? "shared-skill";
  const hash = options.hash ?? `hash-${id}`;
  const physicalId = options.physicalId ?? `device:inode:${id}`;
  const scope = options.scope ?? "global";
  const projectPath = options.projectPath ?? null;
  const locationCount = options.locationCount ?? 1;
  const realpath = `/physical/${id}/${name}`;
  const locations: InstallationLocation[] = Array.from({ length: locationCount }, (_, index) => ({
    id: `location:${id}:${index}`,
    path: index === 0 ? realpath : `/aliases/${id}/${index}/${name}`,
    kind: index === 0 ? "primary" : "alias",
    storageOwner: options.owner ?? "agents",
    scope,
    projectPath,
    present: true,
    valid: true,
    isSymlink: index > 0,
    linkTarget: index > 0 ? realpath : null,
    realpath,
    device: physicalId.split(":")[0],
    inode: physicalId,
    sizeBytes: 1,
    modifiedAt: GENERATED_AT,
    contentHash: hash,
    hashAlgorithm: "sha256-normalized-directory-v1",
    evidenceIds: []
  }));

  return {
    id,
    canonicalSourceId: options.canonicalSourceId ?? null,
    pluginPackageId: null,
    name,
    type: "skill",
    role: "primary",
    storageOwner: options.owner ?? "agents",
    physicalId,
    contentHash: hash,
    hashAlgorithm: "sha256-normalized-directory-v1",
    present: assessment(true),
    valid: assessment(true),
    locations,
    evidenceIds: []
  };
}

function consumer(
  id: string,
  runtime: Owner,
  scope: Scope = "global",
  projectPath: string | null = null
): RuntimeConsumer {
  return {
    id,
    runtime,
    label: id,
    version: null,
    scope,
    projectPath,
    configPaths: [],
    evidenceIds: []
  };
}

interface BindingOptions {
  exposedName?: string;
  priority?: number;
  enabled?: TriState;
  loaded?: TriState;
  visibility?: Binding["visibility"];
  scope?: Scope;
  projectPath?: string | null;
  discovery?: Binding["discovery"];
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
    viaPath: `/visible/${id}/${options.exposedName ?? "shared-skill"}`,
    scope: options.scope ?? "global",
    projectPath: options.projectPath ?? null,
    discovery: options.discovery ?? "default-root",
    priority: options.priority ?? 100,
    visibility: options.visibility ?? "visible",
    shadowedByBindingId: null,
    enabled: assessment(options.enabled ?? true),
    loaded: assessment(options.loaded ?? "unknown"),
    evidenceIds: []
  };
}

function canonicalSource(id: string, name: string): CanonicalSource {
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

function atlasGraph(
  installations: Installation[],
  consumers: RuntimeConsumer[] = [],
  bindings: Binding[] = []
): Atlas {
  const canonicalSourceIds = [...new Set(
    installations
      .map((item) => item.canonicalSourceId)
      .filter((id): id is string => id !== null)
  )];

  return {
    schemaVersion: 2,
    generatedAt: GENERATED_AT,
    computer: { hostname: "test-host", home: "/test-home" },
    warnings: [],
    evidence: [],
    canonicalSources: canonicalSourceIds.map((id) => canonicalSource(id, "shared-skill")),
    installations,
    consumers,
    bindings,
    pluginPackages: [],
    diagnoses: [],
    agents: [],
    projects: [],
    assets: [],
    summary: {
      assetCount: 0,
      canonicalSourceCount: canonicalSourceIds.length,
      installationCount: installations.length,
      bindingCount: bindings.length,
      pluginCount: 0,
      byType: {},
      byOwner: {},
      byScope: {}
    }
  };
}

function relationshipKinds(atlas: Atlas): Array<{ kind: string; severity: string }> {
  return evaluateDiagnoses(atlas).map(({ kind, severity }) => ({ kind, severity }));
}

test("two locations for one physical installation are a healthy alias", () => {
  const shared = installation("shared", {
    physicalId: "16777220:65366880",
    locationCount: 2
  });
  const codex = consumer("consumer:codex", "codex");
  const graph = atlasGraph(
    [shared],
    [codex],
    [binding("binding:shared", shared.id, codex.id)]
  );

  assert.deepEqual(relationshipKinds(graph), [
    { kind: "alias", severity: "healthy" }
  ]);
});

test("identical installations consumed by different runtimes are an informational mirror", () => {
  const canonicalSourceId = "canonical:shared-skill";
  const agentsCopy = installation("agents-copy", {
    hash: "same-normalized-hash",
    canonicalSourceId
  });
  const hermesCopy = installation("hermes-copy", {
    hash: "same-normalized-hash",
    canonicalSourceId,
    owner: "hermes"
  });
  const codex = consumer("consumer:codex", "codex");
  const hermes = consumer("consumer:hermes", "hermes");
  const graph = atlasGraph(
    [agentsCopy, hermesCopy],
    [codex, hermes],
    [
      binding("binding:codex", agentsCopy.id, codex.id),
      binding("binding:hermes", hermesCopy.id, hermes.id)
    ]
  );

  assert.deepEqual(relationshipKinds(graph), [
    { kind: "mirror", severity: "info" }
  ]);
});

test("same-name same-hash bindings at equal priority in one runtime are redundant", () => {
  const first = installation("first", { hash: "same-normalized-hash" });
  const second = installation("second", { hash: "same-normalized-hash" });
  const codex = consumer("consumer:codex", "codex");
  const graph = atlasGraph(
    [first, second],
    [codex],
    [
      binding("binding:first", first.id, codex.id, { priority: 100, loaded: true }),
      binding("binding:second", second.id, codex.id, { priority: 100, loaded: true })
    ]
  );

  assert.deepEqual(relationshipKinds(graph), [
    { kind: "redundant", severity: "attention" }
  ]);
});

test("same-name divergent bindings visible to one runtime are a conflict", () => {
  const first = installation("first", { hash: "hash-a" });
  const second = installation("second", { hash: "hash-b" });
  const claude = consumer("consumer:claude", "claude");
  const graph = atlasGraph(
    [first, second],
    [claude],
    [
      binding("binding:first", first.id, claude.id),
      binding("binding:second", second.id, claude.id)
    ]
  );

  assert.deepEqual(relationshipKinds(graph), [
    { kind: "conflict", severity: "warning" }
  ]);
});

test("divergent same-name installations in different runtimes do not conflict", () => {
  const codexCopy = installation("codex-copy", { hash: "hash-codex", owner: "codex" });
  const claudeCopy = installation("claude-copy", { hash: "hash-claude", owner: "claude" });
  const codex = consumer("consumer:codex", "codex");
  const claude = consumer("consumer:claude", "claude");
  const graph = atlasGraph(
    [codexCopy, claudeCopy],
    [codex, claude],
    [
      binding("binding:codex", codexCopy.id, codex.id),
      binding("binding:claude", claudeCopy.id, claude.id)
    ]
  );

  assert.equal(evaluateDiagnoses(graph).some((item) => item.kind === "conflict"), false);
});

test("project priority shadows a divergent global default instead of conflicting", () => {
  const projectPath = "/projects/atlas";
  const globalCopy = installation("global-copy", { hash: "hash-global" });
  const projectCopy = installation("project-copy", {
    hash: "hash-project",
    owner: "project",
    scope: "project",
    projectPath
  });
  const globalCodex = consumer("consumer:codex:global", "codex");
  const projectCodex = consumer("consumer:codex:project", "codex", "project", projectPath);
  const graph = atlasGraph(
    [globalCopy, projectCopy],
    [globalCodex, projectCodex],
    [
      binding("binding:global", globalCopy.id, globalCodex.id, { priority: 100 }),
      binding("binding:project", projectCopy.id, projectCodex.id, {
        priority: 200,
        scope: "project",
        projectPath,
        discovery: "project-root"
      })
    ]
  );

  const diagnoses = evaluateDiagnoses(graph, projectPath);
  assert.equal(diagnoses.some((item) => item.kind === "conflict"), false);
  assert.equal(diagnoses.some((item) => item.kind === "redundant"), false);
});

test("non-visible and disabled bindings do not participate in conflict diagnosis", () => {
  const enabledCopy = installation("enabled-copy", { hash: "hash-enabled" });
  const unknownCopy = installation("unknown-copy", { hash: "hash-unknown" });
  const disabledCopy = installation("disabled-copy", { hash: "hash-disabled" });
  const hermes = consumer("consumer:hermes", "hermes");
  const graph = atlasGraph(
    [enabledCopy, unknownCopy, disabledCopy],
    [hermes],
    [
      binding("binding:enabled", enabledCopy.id, hermes.id, { enabled: true }),
      binding("binding:unknown", unknownCopy.id, hermes.id, { enabled: "unknown", visibility: "unknown" }),
      binding("binding:disabled", disabledCopy.id, hermes.id, { enabled: false })
    ]
  );

  const diagnoses = evaluateDiagnoses(graph);
  assert.equal(diagnoses.some((item) => item.kind === "conflict"), false);
  assert.equal(diagnoses.some((item) => item.kind === "redundant"), false);
});

test("identical visible bindings without loaded evidence remain uncertain, not redundant", () => {
  const first = installation("first", { hash: "same-normalized-hash" });
  const second = installation("second", { hash: "same-normalized-hash" });
  const codex = consumer("consumer:codex", "codex");
  const graph = atlasGraph(
    [first, second],
    [codex],
    [
      binding("binding:first", first.id, codex.id, { enabled: "unknown" }),
      binding("binding:second", second.id, codex.id, { enabled: "unknown" })
    ]
  );

  assert.deepEqual(relationshipKinds(graph), [
    { kind: "uncertain", severity: "info" }
  ]);
});
