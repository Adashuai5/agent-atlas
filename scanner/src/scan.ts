import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyType, detectOwner } from "./classify.ts";
import type { Asset, AssetType, Owner, Scope, Signals } from "./classify.ts";
import { inspectPathIdentity } from "./identity.ts";
import {
  ATLAS_GRAPH_SCHEMA_VERSION,
  type AssessmentConfidence,
  type Binding,
  type BindingDiscovery,
  type CanonicalSource,
  type Diagnosis,
  type Evidence,
  type EvidenceKind,
  type Installation,
  type InstallationLocation,
  type JsonValue,
  type PluginPackage as GraphPluginPackage,
  type RuntimeConsumer,
  type StateAssessment,
  type TriState
} from "./model.ts";
import { discoverPluginPackages } from "./plugins.ts";
import type {
  Evidence as PluginEvidence,
  EvidencedPluginState,
  PluginPackage as DiscoveredPluginPackage,
  PluginRuntime
} from "./plugins.ts";
import { readHermesExternalDirs, readSkillLock } from "./provenance.ts";
import type { SkillLockRecord } from "./provenance.ts";
import { evaluateDiagnoses } from "./relations.ts";
import {
  desktopDir as defaultDesktopDir,
  explicitProjectRoots as defaultExplicitProjectRoots,
  homeDir as defaultHomeDir,
  projectConfigNames,
  projectMarkerNames,
  rootConfigNames,
  shouldSkipDesktop as defaultShouldSkipDesktop,
  skipDirNames
} from "./paths.ts";

type RuntimeName = Extract<Owner, "codex" | "claude" | "hermes">;

export interface AtlasSummary {
  assetCount: number;
  canonicalSourceCount: number;
  installationCount: number;
  bindingCount: number;
  pluginCount: number;
  byType: Record<string, number>;
  byOwner: Record<string, number>;
  byScope: Record<string, number>;
}

export interface Atlas {
  schemaVersion: typeof ATLAS_GRAPH_SCHEMA_VERSION;
  generatedAt: string;
  computer: {
    hostname: string;
    home: string;
  };
  warnings: string[];
  evidence: Evidence[];
  canonicalSources: CanonicalSource[];
  installations: Installation[];
  consumers: RuntimeConsumer[];
  bindings: Binding[];
  pluginPackages: GraphPluginPackage[];
  diagnoses: Diagnosis[];
  agents: Asset[];
  projects: Asset[];
  assets: Asset[];
  summary: AtlasSummary;
}

export interface ScanOptions {
  homeDir?: string;
  desktopDir?: string;
  explicitProjectRoots?: string[];
  skipDesktop?: boolean;
  generatedAt?: string;
  hostname?: string;
  discoverPlugins?: boolean;
}

interface BindingSpec {
  runtime: RuntimeName;
  scope: Extract<Scope, "global" | "project">;
  projectPath: string | null;
  discovery: BindingDiscovery;
  priority: number;
  enabled: TriState;
  enabledConfidence: AssessmentConfidence;
  enabledReason: string;
  enabledEvidence?: {
    source: string;
    path: string;
    detail: string;
    attributes?: Record<string, JsonValue>;
  };
}

interface Candidate {
  path: string;
  projectPath: string | null;
  scope: Scope;
  placementOwner: Owner;
  forceType?: AssetType;
  displayName?: string;
  bindings: BindingSpec[];
  pluginDiscoveryId?: string;
}

interface ScannedCandidate {
  candidate: Candidate;
  asset: Asset;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20);
  return `${prefix}:${digest}`;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
}

function recordReadWarning(warnings: string[] | undefined, operation: string, filePath: string, error: unknown): void {
  const code = errorCode(error);
  if (warnings && !["ENOENT", "ENOTDIR"].includes(code)) warnings.push(`${operation} ${filePath}: ${code}`);
}

async function exists(filePath: string, warnings?: string[]): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    recordReadWarning(warnings, "Cannot access", filePath, error);
    return false;
  }
}

async function safeStat(filePath: string, warnings?: string[]) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    recordReadWarning(warnings, "Cannot stat", filePath, error);
    return null;
  }
}

async function listDir(filePath: string, warnings?: string[]) {
  try {
    return await fs.readdir(filePath, { withFileTypes: true });
  } catch (error) {
    recordReadWarning(warnings, "Cannot read", filePath, error);
    return [];
  }
}

async function listDirWithWarning(filePath: string, warnings: string[]) {
  try {
    return await fs.readdir(filePath, { withFileTypes: true });
  } catch (error) {
    const code = errorCode(error);
    warnings.push(`Cannot read ${filePath}: ${code}`);
    return [];
  }
}

function configType(filePath: string): AssetType {
  const lower = path.basename(filePath).toLowerCase();
  if (["agents.md", "claude.md", "memory.md", "user.md", "soul.md"].includes(lower)) return "memory";
  if (lower === ".mcp.json") return "mcp";
  return "config";
}

function bindingForRoot(
  runtime: RuntimeName | null,
  scope: Extract<Scope, "global" | "project">,
  projectPath: string | null,
  discovery: BindingDiscovery,
  enabled: TriState = "unknown",
  priority = scope === "project" ? 200 : 100
): BindingSpec[] {
  if (!runtime) return [];
  return [{
    runtime,
    scope,
    projectPath,
    discovery,
    priority,
    enabled,
    enabledConfidence: enabled === "unknown" ? "unknown" : "confirmed",
    enabledReason: enabled === true
      ? "Resource is in a documented runtime discovery location."
      : enabled === false
        ? "Runtime configuration explicitly disables this resource."
        : "The resource exists, but no activation evidence was found."
  }];
}

function applyHermesDisabledBindings(
  candidates: Candidate[],
  disabledNames: ReadonlySet<string>,
  configPath: string
): void {
  if (disabledNames.size === 0) return;
  for (const candidate of candidates) {
    if (candidate.forceType !== "skill") continue;
    const skillName = candidate.displayName ?? path.basename(candidate.path);
    if (!disabledNames.has(skillName)) continue;
    for (const binding of candidate.bindings) {
      if (binding.runtime !== "hermes" || binding.scope !== "global") continue;
      binding.enabled = false;
      binding.enabledConfidence = "confirmed";
      binding.enabledReason = `Hermes skills.disabled explicitly disables ${skillName}.`;
      binding.enabledEvidence = {
        source: "hermes-skills-disabled",
        path: configPath,
        detail: `Hermes skills.disabled explicitly lists ${skillName}.`,
        attributes: { runtime: "hermes", skill: skillName }
      };
    }
  }
}

function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.forceType ?? "auto"}\0${path.resolve(candidate.path)}`;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, { ...candidate, bindings: [...candidate.bindings] });
      continue;
    }
    const seen = new Set(current.bindings.map((binding) => JSON.stringify(binding)));
    for (const binding of candidate.bindings) {
      const serialized = JSON.stringify(binding);
      if (!seen.has(serialized)) current.bindings.push(binding);
    }
    current.pluginDiscoveryId ??= candidate.pluginDiscoveryId;
    current.displayName ??= candidate.displayName;
  }
  return [...unique.values()];
}

async function hasSkillMd(directoryPath: string, warnings?: string[]): Promise<boolean> {
  return exists(path.join(directoryPath, "SKILL.md"), warnings);
}

async function collectSkillCandidates(input: {
  root: string;
  placementOwner: Owner;
  runtime: RuntimeName | null;
  scope: Extract<Scope, "global" | "project">;
  projectPath: string | null;
  discovery: BindingDiscovery;
  recursive: boolean;
  maxDepth?: number;
  priority?: number;
  warnings?: string[];
}): Promise<Candidate[]> {
  if (!(await exists(input.root, input.warnings))) return [];
  const candidates: Candidate[] = [];
  const stack: Array<{ directory: string; depth: number }> = [{ directory: input.root, depth: 0 }];
  const maxDepth = input.maxDepth ?? 8;
  const visitedDirectories = new Set<string>();

  while (stack.length) {
    const { directory, depth } = stack.pop()!;
    try {
      const realDirectory = await fs.realpath(directory);
      if (visitedDirectories.has(realDirectory)) continue;
      visitedDirectories.add(realDirectory);
    } catch {
      continue;
    }
    for (const entry of await listDir(directory, input.warnings)) {
      if (skipDirNames.has(entry.name) || entry.name === ".DS_Store") continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const targetStat = await safeStat(entryPath, input.warnings);
        const validSkill = Boolean(targetStat?.isDirectory() && await hasSkillMd(entryPath, input.warnings));
        // A broken link directly exposed from a skills root is still important
        // inventory: present=true, valid=false will explain why it cannot load.
        if (validSkill || (!targetStat && depth === 0)) {
          candidates.push({
            path: entryPath,
            projectPath: input.projectPath,
            scope: input.scope,
            placementOwner: input.placementOwner,
            forceType: "skill",
            bindings: bindingForRoot(input.runtime, input.scope, input.projectPath, input.discovery, "unknown", input.priority)
          });
        } else if (targetStat?.isDirectory() && input.recursive && depth < maxDepth) {
          stack.push({ directory: entryPath, depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (await hasSkillMd(entryPath, input.warnings)) {
        candidates.push({
          path: entryPath,
          projectPath: input.projectPath,
          scope: input.scope,
          placementOwner: input.placementOwner,
          forceType: "skill",
          bindings: bindingForRoot(input.runtime, input.scope, input.projectPath, input.discovery, "unknown", input.priority)
        });
      } else if (input.recursive && depth < maxDepth) {
        stack.push({ directory: entryPath, depth: depth + 1 });
      }
    }
  }
  return candidates;
}

async function collectAgentCandidates(input: {
  root: string;
  placementOwner: Owner;
  runtime: RuntimeName | null;
  scope: Extract<Scope, "global" | "project">;
  projectPath: string | null;
  warnings?: string[];
}): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const entry of await listDir(input.root, input.warnings)) {
    if (skipDirNames.has(entry.name)) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!/\.(md|json|ya?ml)$/i.test(entry.name)) continue;
    candidates.push({
      path: path.join(input.root, entry.name),
      projectPath: input.projectPath,
      scope: input.scope,
      placementOwner: input.placementOwner,
      forceType: "agent",
      bindings: bindingForRoot(input.runtime, input.scope, input.projectPath, input.scope === "project" ? "project-root" : "default-root")
    });
  }
  return candidates;
}

async function collectRuntimeRootCandidates(input: {
  root: string;
  placementOwner: Owner;
  runtime: RuntimeName | null;
  scope: Extract<Scope, "global" | "project">;
  projectPath: string | null;
  recursiveSkills?: boolean;
  warnings?: string[];
}): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const discovery: BindingDiscovery = input.scope === "project" ? "project-root" : "default-root";
  for (const entry of await listDir(input.root, input.warnings)) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!rootConfigNames.has(entry.name)) continue;
    const entryPath = path.join(input.root, entry.name);
    const type = configType(entryPath);
    const activation: TriState = "unknown";
    candidates.push({
      path: entryPath,
      projectPath: input.projectPath,
      scope: input.scope,
      placementOwner: input.placementOwner,
      forceType: type,
      bindings: bindingForRoot(input.runtime, input.scope, input.projectPath, discovery, activation)
    });
  }
  candidates.push(...await collectSkillCandidates({
    root: path.join(input.root, "skills"),
    placementOwner: input.placementOwner,
    runtime: input.runtime,
    scope: input.scope,
    projectPath: input.projectPath,
    discovery,
    recursive: input.recursiveSkills ?? true,
    warnings: input.warnings
  }));
  candidates.push(...await collectAgentCandidates({
    root: path.join(input.root, "agents"),
    placementOwner: input.placementOwner,
    runtime: input.runtime,
    scope: input.scope,
    projectPath: input.projectPath,
    warnings: input.warnings
  }));
  for (const sessionName of ["sessions", "history"]) {
    const sessionPath = path.join(input.root, sessionName);
    if (await exists(sessionPath, input.warnings)) {
      candidates.push({
        path: sessionPath,
        projectPath: input.projectPath,
        scope: input.scope,
        placementOwner: input.placementOwner,
        forceType: "session",
        bindings: []
      });
    }
  }
  return candidates;
}

async function collectGlobalCandidates(homeDir: string, warnings: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const hermesSkillConfig = await readHermesExternalDirs(homeDir);
  if (hermesSkillConfig.warning) warnings.push(hermesSkillConfig.warning);
  const hermesDisabledNames = new Set(hermesSkillConfig.disabled);
  const runtimeRoots: Array<{ owner: Owner; runtime: RuntimeName | null; recursiveSkills: boolean }> = [
    { owner: "codex", runtime: "codex", recursiveSkills: true },
    { owner: "claude", runtime: "claude", recursiveSkills: false },
    { owner: "agents", runtime: null, recursiveSkills: false },
    { owner: "hermes", runtime: "hermes", recursiveSkills: true }
  ];
  for (const root of runtimeRoots) {
    const rootCandidates = await collectRuntimeRootCandidates({
      root: path.join(homeDir, `.${root.owner}`),
      placementOwner: root.owner,
      runtime: root.runtime,
      scope: "global",
      projectPath: null,
      recursiveSkills: root.recursiveSkills,
      warnings
    });
    if (root.runtime === "hermes") {
      applyHermesDisabledBindings(rootCandidates, hermesDisabledNames, hermesSkillConfig.path);
    }
    candidates.push(...rootCandidates);
  }

  // Hermes' repository copy is inventory, not a runtime binding. The local
  // ~/.hermes/skills tree has precedence and is scanned above.
  candidates.push(...await collectSkillCandidates({
    root: path.join(homeDir, ".hermes", "hermes-agent", "skills"),
    placementOwner: "hermes",
    runtime: null,
    scope: "global",
    projectPath: null,
    discovery: "unknown",
    recursive: true,
    warnings
  }));

  for (const externalRoot of hermesSkillConfig.paths) {
    const externalCandidates = await collectSkillCandidates({
      root: externalRoot,
      placementOwner: "unknown",
      runtime: "hermes",
      scope: "global",
      projectPath: null,
      discovery: "external-dir",
      recursive: true,
      priority: 50,
      warnings
    });
    applyHermesDisabledBindings(externalCandidates, hermesDisabledNames, hermesSkillConfig.path);
    candidates.push(...externalCandidates);
  }

  const claudeHomeConfig = path.join(homeDir, ".claude.json");
  if (await exists(claudeHomeConfig, warnings)) {
    candidates.push({
      path: claudeHomeConfig,
      projectPath: null,
      scope: "global",
      placementOwner: "claude",
      forceType: "config",
      bindings: bindingForRoot("claude", "global", null, "configuration", "unknown")
    });
  }
  return candidates;
}

async function collectProjectCandidates(projectPath: string, warnings?: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const projectEntries = await listDir(projectPath, warnings);
  const hasAiConfig = projectEntries.some((entry) => projectConfigNames.has(entry.name));
  const hasProjectMarker = projectEntries.some((entry) => projectMarkerNames.has(entry.name));
  if (!hasAiConfig && !hasProjectMarker) return candidates;

  candidates.push({
    path: projectPath,
    projectPath,
    scope: "project",
    placementOwner: "project",
    forceType: "project",
    bindings: []
  });

  for (const entry of projectEntries) {
    const entryPath = path.join(projectPath, entry.name);
    const linkedStat = entry.isSymbolicLink() ? await safeStat(entryPath, warnings) : null;
    const isFileEntry = entry.isFile() || Boolean(linkedStat?.isFile());
    const isDirectoryEntry = entry.isDirectory() || Boolean(linkedStat?.isDirectory());
    if (isFileEntry) {
      if (!projectConfigNames.has(entry.name) || !rootConfigNames.has(entry.name)) continue;
      const type = configType(entryPath);
      const runtimes: RuntimeName[] = entry.name === "AGENTS.md"
        ? ["codex"]
        : ["CLAUDE.md", "MEMORY.md", "USER.md"].includes(entry.name)
          ? ["claude"]
          : entry.name === ".mcp.json"
            ? ["codex", "claude"]
            : [];
      const enabled: TriState = "unknown";
      candidates.push({
        path: entryPath,
        projectPath,
        scope: "project",
        placementOwner: "project",
        forceType: type,
        bindings: runtimes.flatMap((runtime) => bindingForRoot(runtime, "project", projectPath, "project-root", enabled))
      });
      continue;
    }
    if (!isDirectoryEntry || ![".codex", ".claude", ".agents", ".hermes"].includes(entry.name)) continue;
    const owner = entry.name.slice(1) as Owner;
    const runtime = owner === "codex" || owner === "claude" || owner === "hermes" ? owner : null;
    candidates.push(...await collectRuntimeRootCandidates({
      root: entryPath,
      placementOwner: "project",
      runtime,
      scope: "project",
      projectPath,
      recursiveSkills: true,
      warnings
    }));
  }
  return candidates;
}

async function collectDesktopProjects(options: Required<Pick<ScanOptions, "desktopDir" | "explicitProjectRoots" | "skipDesktop">>, warnings: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const entries = options.skipDesktop ? [] : await listDirWithWarning(options.desktopDir, warnings);
  for (const entry of entries) {
    if (!entry.isDirectory() || skipDirNames.has(entry.name)) continue;
    candidates.push(...await collectProjectCandidates(path.join(options.desktopDir, entry.name), warnings));
  }
  for (const projectPath of options.explicitProjectRoots) {
    const resolved = path.resolve(projectPath);
    const projectCandidates = await collectProjectCandidates(resolved, warnings);
    if (projectCandidates.length === 0) warnings.push(`Explicit project root has no recognized AI config or project marker: ${resolved}`);
    candidates.push(...projectCandidates);
  }
  return candidates;
}

async function buildSignals(filePath: string, type: AssetType, identityValid: boolean, warnings?: string[]): Promise<Signals> {
  const signals: Signals = { isDirectory: false };
  if (!identityValid) return signals;
  const stat = await safeStat(filePath, warnings);
  if (!stat) return signals;
  signals.isDirectory = stat.isDirectory();
  if (stat.isDirectory()) {
    const entries = await listDir(filePath, warnings);
    const names = new Set(entries.map((entry) => entry.name));
    signals.hasSkillMd = names.has("SKILL.md");
    signals.hasReadme = names.has("README.md");
    signals.hasMcpConfig = names.has(".mcp.json");
    signals.childCount = entries.length;
    if (type === "session") signals.sessionCount = entries.length;
  }
  if (type === "plugin") signals.pluginPackage = true;
  return signals;
}

interface SemanticValidity {
  value: TriState;
  confidence: AssessmentConfidence;
  reason: string;
}

async function semanticValidity(candidate: Candidate, type: AssetType, identityValid: boolean, warnings: string[]): Promise<SemanticValidity> {
  if (!identityValid) return { value: false, confidence: "confirmed", reason: "The target is unavailable." };
  if (type === "skill") {
    const valid = await hasSkillMd(candidate.path, warnings);
    return { value: valid, confidence: "confirmed", reason: valid ? "SKILL.md is present." : "SKILL.md is missing." };
  }
  if (type === "project") {
    const valid = Boolean((await safeStat(candidate.path, warnings))?.isDirectory());
    return { value: valid, confidence: "confirmed", reason: valid ? "Project directory is readable." : "Project path is not a readable directory." };
  }
  const extension = path.extname(candidate.path).toLowerCase();
  if (extension === ".json" || path.basename(candidate.path) === ".mcp.json") {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(candidate.path, "utf8"));
      const valid = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
      if (!valid) warnings.push(`Invalid JSON object in ${candidate.path}`);
      return { value: valid, confidence: "confirmed", reason: valid ? "JSON parsed as an object." : "JSON root is not an object." };
    } catch (error) {
      warnings.push(`Cannot parse JSON ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`);
      return { value: false, confidence: "confirmed", reason: "JSON parsing failed." };
    }
  }
  if ([".toml", ".yaml", ".yml"].includes(extension)) {
    try {
      const readable = (await fs.readFile(candidate.path, "utf8")).trim().length > 0;
      return readable
        ? { value: "unknown", confidence: "inferred", reason: "The file is readable, but no format parser verified its syntax." }
        : { value: false, confidence: "confirmed", reason: "The configuration file is empty." };
    } catch (error) {
      recordReadWarning(warnings, "Cannot read", candidate.path, error);
      return { value: false, confidence: "confirmed", reason: "The configuration file is unreadable." };
    }
  }
  return { value: true, confidence: "confirmed", reason: "The required filesystem structure is readable." };
}

function assessment(value: TriState, confidence: AssessmentConfidence, evidenceIds: string[], reason: string | null): StateAssessment {
  return { value, confidence, evidenceIds, reason };
}

function addEvidenceFactory(target: Map<string, Evidence>, observedAt: string) {
  return (input: {
    kind: EvidenceKind;
    source: string;
    path: string | null;
    detail: string;
    attributes?: Record<string, JsonValue>;
  }): string => {
    const id = stableId("evidence", input.kind, input.source, input.path ?? "", input.detail);
    if (!target.has(id)) target.set(id, { id, observedAt, ...input });
    return id;
  };
}

async function makeAsset(candidate: Candidate, homeDir: string, generatedAt: string, warnings: string[], addEvidence: ReturnType<typeof addEvidenceFactory>): Promise<Asset> {
  const identity = await inspectPathIdentity(candidate.path);
  const provisionalSignals = await buildSignals(candidate.path, candidate.forceType ?? "config", identity.valid, warnings);
  const type = candidate.forceType ?? classifyType(candidate.path, Boolean(provisionalSignals.isDirectory), provisionalSignals);
  const signals = await buildSignals(candidate.path, type, identity.valid, warnings);
  const valid = await semanticValidity(candidate, type, identity.valid, warnings);
  if (identity.valid && !identity.contentHash && type !== "session") warnings.push(`Cannot hash ${identity.realpath ?? candidate.path}`);
  const identityPath = identity.realpath ?? candidate.path;
  const owner = detectOwner(identityPath, homeDir, candidate.projectPath);
  const presentEvidenceId = addEvidence({
    kind: identity.isSymlink ? "symlink" : "filesystem",
    source: "filesystem-scan",
    path: candidate.path,
    detail: identity.present
      ? identity.isSymlink ? "Symbolic-link location exists." : "Filesystem location exists."
      : "Filesystem location is missing.",
    attributes: {
      realpath: identity.realpath,
      device: identity.device,
      inode: identity.inode,
      linkTarget: identity.linkTarget
    }
  });
  const validEvidenceId = addEvidence({
    kind: "filesystem",
    source: "resource-validator",
    path: candidate.path,
    detail: valid.reason
  });
  const hashEvidenceId = identity.contentHash ? addEvidence({
    kind: "content-hash",
    source: identity.hashAlgorithm ?? "content-hash",
    path: identity.realpath ?? candidate.path,
    detail: `Content fingerprint ${identity.contentHash}.`,
    attributes: { algorithm: identity.hashAlgorithm, hash: identity.contentHash }
  }) : null;

  return {
    id: stableId("asset", candidate.path, type),
    name: candidate.displayName ?? path.basename(candidate.path),
    type,
    owner,
    placementOwner: candidate.placementOwner,
    scope: candidate.scope,
    path: candidate.path,
    projectPath: candidate.projectPath,
    sizeBytes: identity.sizeBytes ?? 0,
    modifiedAt: identity.modifiedAt ?? generatedAt,
    signals,
    identity,
    states: {
      present: assessment(identity.present, "confirmed", [presentEvidenceId], identity.present ? "Location exists." : "Location is missing."),
      valid: assessment(valid.value, valid.confidence, [validEvidenceId], valid.reason)
    },
    graph: {
      canonicalSourceId: null,
      installationId: null,
      locationId: null,
      bindingIds: [],
      pluginPackageId: null
    }
  };
}

function physicalKey(asset: Asset): string {
  const identity = asset.identity;
  if (identity.device && identity.inode) return `${asset.type}:physical:${identity.device}:${identity.inode}`;
  return `${asset.type}:location:${asset.path}`;
}

function buildInstallations(scanned: ScannedCandidate[], addEvidence: ReturnType<typeof addEvidenceFactory>): Installation[] {
  const groups = new Map<string, ScannedCandidate[]>();
  for (const item of scanned) {
    const key = physicalKey(item.asset);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const installations: Installation[] = [];
  for (const [key, group] of groups) {
    group.sort((left, right) => Number(left.asset.identity.isSymlink) - Number(right.asset.identity.isSymlink) || left.asset.path.localeCompare(right.asset.path));
    const first = group[0].asset;
    const installationId = stableId("installation", key);
    const locations: InstallationLocation[] = group.map((item, index) => {
      const asset = item.asset;
      const locationId = stableId("location", asset.path, asset.type);
      asset.graph.installationId = installationId;
      asset.graph.locationId = locationId;
      return {
        id: locationId,
        path: asset.path,
        kind: asset.identity.isSymlink ? "symlink" : index === 0 ? "primary" : "alias",
        storageOwner: asset.placementOwner,
        scope: asset.scope,
        projectPath: asset.projectPath,
        evidenceIds: [...asset.states.present.evidenceIds, ...asset.states.valid.evidenceIds],
        ...asset.identity
      };
    });
    const physicalId = first.identity.device && first.identity.inode ? `${first.identity.device}:${first.identity.inode}` : null;
    const evidenceIds = [...new Set(group.flatMap((item) => [
      ...item.asset.states.present.evidenceIds,
      ...item.asset.states.valid.evidenceIds
    ]))];
    if (first.identity.contentHash) {
      evidenceIds.push(addEvidence({
        kind: "content-hash",
        source: first.identity.hashAlgorithm ?? "content-hash",
        path: first.identity.realpath ?? first.path,
        detail: `Installation fingerprint ${first.identity.contentHash}.`
      }));
    }
    const presentValue: TriState = group.some((item) => item.asset.states.present.value === true) ? true : false;
    const validValues = group.map((item) => item.asset.states.valid.value);
    const validValue: TriState = validValues.some((value) => value === true)
      ? true
      : validValues.some((value) => value === "unknown")
        ? "unknown"
        : false;
    installations.push({
      id: installationId,
      canonicalSourceId: null,
      pluginPackageId: null,
      role: "primary",
      name: first.name,
      type: first.type,
      storageOwner: first.owner,
      physicalId,
      contentHash: first.identity.contentHash,
      hashAlgorithm: first.identity.hashAlgorithm,
      present: assessment(presentValue, "confirmed", evidenceIds, "Aggregated from installation locations."),
      valid: assessment(validValue, validValue === "unknown" ? "inferred" : "confirmed", evidenceIds, "Aggregated from resource validation."),
      locations,
      evidenceIds: [...new Set(evidenceIds)]
    });
  }
  return installations.sort((left, right) => left.id.localeCompare(right.id));
}

function installationLockRecord(installation: Installation, homeDir: string, records: Map<string, SkillLockRecord>): SkillLockRecord | null {
  if (installation.type !== "skill") return null;
  for (const record of records.values()) {
    const expectedPath = path.join(homeDir, ".agents", "skills", record.name);
    if (installation.locations.some((location) => path.resolve(location.path) === expectedPath || location.realpath === expectedPath)) return record;
  }
  return null;
}

function buildCanonicalSources(
  installations: Installation[],
  assets: Asset[],
  homeDir: string,
  lockRecords: Map<string, SkillLockRecord>,
  lockPath: string,
  addEvidence: ReturnType<typeof addEvidenceFactory>
): CanonicalSource[] {
  const primaryRank = (installation: Installation): number => {
    if (lockByInstallation.has(installation.id)) return 0;
    const paths = installation.locations.map((location) => path.resolve(location.path));
    const hermesLocalRoot = path.join(homeDir, ".hermes", "skills");
    const hermesRepositoryRoot = path.join(homeDir, ".hermes", "hermes-agent", "skills");
    if (paths.some((location) => isInside(location, hermesLocalRoot) && !isInside(location, hermesRepositoryRoot))) return 10;
    if (paths.some((location) => isInside(location, path.join(homeDir, ".agents", "skills")))) return 10;
    if (paths.some((location) => isInside(location, hermesRepositoryRoot))) return 50;
    return 30;
  };
  const lockByInstallation = new Map<string, SkillLockRecord>();
  const contentToLockKey = new Map<string, string>();
  for (const installation of installations) {
    const record = installationLockRecord(installation, homeDir, lockRecords);
    if (!record) continue;
    lockByInstallation.set(installation.id, record);
    if (installation.contentHash) {
      contentToLockKey.set(`${installation.type}:${record.name.toLowerCase()}:${installation.contentHash}`, `lock:${record.sourceUrl ?? record.source ?? "unknown"}:${record.skillPath ?? record.name}`);
    }
  }

  const groups = new Map<string, Installation[]>();
  for (const installation of installations) {
    const lock = lockByInstallation.get(installation.id);
    const normalizedName = installation.name.toLowerCase();
    const contentKey = installation.contentHash ? `${installation.type}:${normalizedName}:${installation.contentHash}` : null;
    const key = lock
      ? `lock:${lock.sourceUrl ?? lock.source ?? "unknown"}:${lock.skillPath ?? lock.name}`
      : contentKey && contentToLockKey.has(contentKey)
        ? contentToLockKey.get(contentKey)!
        : installation.contentHash
          ? `content:${contentKey}`
          : `physical:${installation.id}`;
    const group = groups.get(key) ?? [];
    group.push(installation);
    groups.set(key, group);
  }

  const sources: CanonicalSource[] = [];
  for (const [key, group] of groups) {
    group.sort((left, right) => primaryRank(left) - primaryRank(right) || left.id.localeCompare(right.id));
    const first = group[0];
    const record = group.map((installation) => lockByInstallation.get(installation.id)).find(Boolean) ?? null;
    const evidenceIds = [...new Set(group.flatMap((installation) => installation.evidenceIds))];
    if (record) {
      evidenceIds.push(addEvidence({
        kind: "skill-lock",
        source: `skill-lock-v3`,
        path: lockPath,
        detail: `Skill ${record.name} records upstream source ${record.source ?? "unknown"}.`,
        attributes: {
          source: record.source,
          sourceType: record.sourceType,
          sourceUrl: record.sourceUrl,
          skillPath: record.skillPath,
          skillFolderHash: record.skillFolderHash
        }
      }));
    }
    const sourceId = stableId("canonical", key);
    group.forEach((installation, index) => {
      installation.canonicalSourceId = sourceId;
      installation.role = index === 0 ? "primary" : "mirror";
    });
    sources.push({
      id: sourceId,
      name: record?.name ?? first.name,
      type: first.type,
      sourceType: record?.sourceType ?? (first.type === "plugin" ? "plugin-manifest" : "content-identity"),
      source: record?.source ?? null,
      sourceUrl: record?.sourceUrl ?? null,
      sourcePath: record?.skillPath ?? null,
      revision: null,
      expectedContentHash: record?.skillFolderHash || null,
      expectedHashAlgorithm: record?.skillFolderHash ? "skill-lock-folder-hash-v3" : null,
      confidence: record ? "confirmed" : first.contentHash ? "inferred" : "unknown",
      evidenceIds: [...new Set(evidenceIds)]
    });
  }

  const byInstallation = new Map(installations.map((installation) => [installation.id, installation]));
  for (const asset of assets) {
    const installation = asset.graph.installationId ? byInstallation.get(asset.graph.installationId) : null;
    asset.graph.canonicalSourceId = installation?.canonicalSourceId ?? null;
  }
  return sources.sort((left, right) => left.id.localeCompare(right.id));
}

function consumerId(runtime: RuntimeName, scope: Extract<Scope, "global" | "project">, projectPath: string | null): string {
  return stableId("consumer", runtime, scope, projectPath ?? "global");
}

function buildBindings(
  scanned: ScannedCandidate[],
  installations: Installation[],
  addEvidence: ReturnType<typeof addEvidenceFactory>
): { consumers: RuntimeConsumer[]; bindings: Binding[] } {
  const consumers = new Map<string, RuntimeConsumer>();
  const bindings = new Map<string, Binding>();
  const installationById = new Map(installations.map((installation) => [installation.id, installation]));

  for (const { candidate, asset } of scanned) {
    if (!asset.graph.installationId || !asset.graph.locationId) continue;
    const installation = installationById.get(asset.graph.installationId);
    if (!installation) continue;
    for (const spec of candidate.bindings) {
      const targetConsumerId = consumerId(spec.runtime, spec.scope, spec.projectPath);
      const discoveryEvidenceId = addEvidence({
        kind: "configuration",
        source: spec.discovery,
        path: candidate.path,
        detail: `${spec.runtime} discovers this resource through ${spec.discovery}.`,
        attributes: { runtime: spec.runtime, scope: spec.scope, projectPath: spec.projectPath }
      });
      const explicitEnabledEvidenceId = spec.enabledEvidence ? addEvidence({
        kind: "configuration",
        ...spec.enabledEvidence
      }) : null;
      const bindingEvidenceIds = explicitEnabledEvidenceId
        ? [discoveryEvidenceId, explicitEnabledEvidenceId]
        : [discoveryEvidenceId];
      if (!consumers.has(targetConsumerId)) {
        consumers.set(targetConsumerId, {
          id: targetConsumerId,
          runtime: spec.runtime,
          label: spec.runtime === "codex" ? "Codex" : spec.runtime === "claude" ? "Claude" : "Hermes",
          version: null,
          scope: spec.scope,
          projectPath: spec.projectPath,
          configPaths: [],
          evidenceIds: []
        });
      }
      const consumer = consumers.get(targetConsumerId)!;
      if (["config", "memory", "mcp"].includes(asset.type) && !consumer.configPaths.includes(candidate.path)) consumer.configPaths.push(candidate.path);
      for (const evidenceId of bindingEvidenceIds) {
        if (!consumer.evidenceIds.includes(evidenceId)) consumer.evidenceIds.push(evidenceId);
      }

      const id = stableId("binding", targetConsumerId, installation.id, candidate.path);
      if (bindings.has(id)) continue;
      const enabledEvidence = explicitEnabledEvidenceId
        ? [explicitEnabledEvidenceId]
        : spec.enabled === "unknown" ? [] : [discoveryEvidenceId];
      bindings.set(id, {
        id,
        installationId: installation.id,
        consumerId: targetConsumerId,
        viaLocationId: asset.graph.locationId,
        viaPath: candidate.path,
        scope: spec.scope,
        projectPath: spec.projectPath,
        discovery: spec.discovery,
        priority: spec.priority,
        visibility: "visible",
        shadowedByBindingId: null,
        enabled: assessment(spec.enabled, spec.enabledConfidence, enabledEvidence, spec.enabledReason),
        loaded: assessment("unknown", "unknown", [], "No runtime or session loading evidence was collected."),
        evidenceIds: bindingEvidenceIds
      });
      asset.graph.bindingIds.push(id);
    }
  }

  const bindingList = [...bindings.values()];
  const precedenceGroups = new Map<string, Binding[]>();
  for (const binding of bindingList) {
    const installation = installationById.get(binding.installationId);
    if (!installation) continue;
    const exposedName = path.basename(binding.viaPath).replace(/\.md$/i, "").toLowerCase();
    const key = `${binding.consumerId}:${installation.type}:${exposedName}`;
    const group = precedenceGroups.get(key) ?? [];
    group.push(binding);
    precedenceGroups.set(key, group);
  }
  for (const group of precedenceGroups.values()) {
    const highest = Math.max(...group.map((binding) => binding.priority ?? 0));
    const winner = group.find((binding) => (binding.priority ?? 0) === highest) ?? null;
    for (const binding of group) {
      if ((binding.priority ?? 0) >= highest) continue;
      binding.visibility = "shadowed";
      binding.shadowedByBindingId = winner?.id ?? null;
    }
  }

  return {
    consumers: [...consumers.values()].sort((left, right) => left.id.localeCompare(right.id)),
    bindings: bindingList.sort((left, right) => left.id.localeCompare(right.id))
  };
}

function pluginEvidenceKind(evidence: PluginEvidence): EvidenceKind {
  if (evidence.kind === "manifest") return "manifest";
  if (evidence.kind === "installation-root") return "filesystem";
  if (["settings-enabled", "settings-disabled", "install-marker"].includes(evidence.kind)) return "configuration";
  return "inference";
}

function pluginState(
  stateValue: EvidencedPluginState,
  evidenceIds: string[],
  affirmativeReason: string,
  negativeReason: string
): StateAssessment {
  const value: TriState = stateValue.value === "yes" ? true : stateValue.value === "no" ? false : "unknown";
  return assessment(
    value,
    value === "unknown" ? "unknown" : "confirmed",
    evidenceIds,
    value === true ? affirmativeReason : value === false ? negativeReason : "No evidence was found for this lifecycle state."
  );
}

function buildPluginPackages(
  discovered: DiscoveredPluginPackage[],
  scanned: ScannedCandidate[],
  installations: Installation[],
  consumers: RuntimeConsumer[],
  addEvidence: ReturnType<typeof addEvidenceFactory>
): GraphPluginPackage[] {
  const installationById = new Map(installations.map((installation) => [installation.id, installation]));
  const assetByPlugin = new Map(scanned.filter((item) => item.candidate.pluginDiscoveryId).map((item) => [item.candidate.pluginDiscoveryId!, item.asset]));
  return discovered.map((plugin) => {
    const graphEvidenceByPluginId = new Map<string, string>();
    for (const item of plugin.evidence) {
      graphEvidenceByPluginId.set(item.id, addEvidence({
        kind: pluginEvidenceKind(item),
        source: `plugin-discovery:${item.kind}`,
        path: item.path,
        detail: item.detail
      }));
    }
    const mapStateEvidence = (stateValue: EvidencedPluginState): string[] => stateValue.evidence
      .map((item) => graphEvidenceByPluginId.get(item.id))
      .filter((id): id is string => Boolean(id));
    const asset = assetByPlugin.get(plugin.id) ?? null;
    const installation = asset?.graph.installationId ? installationById.get(asset.graph.installationId) ?? null : null;
    const runtimeConsumer = consumers.find((consumer) => consumer.runtime === plugin.runtime && consumer.scope === "global") ?? null;
    const id = stableId("plugin", plugin.id);
    if (asset) asset.graph.pluginPackageId = id;
    const validState = pluginState(
      plugin.valid,
      mapStateEvidence(plugin.valid),
      "Plugin manifest parsed successfully.",
      "Plugin manifest is invalid."
    );
    if (asset) asset.states.valid = validState;
    if (installation) {
      installation.pluginPackageId = id;
      installation.valid = validState;
    }
    return {
      id,
      name: plugin.name,
      version: plugin.version,
      kind: plugin.sourceKind === "catalog"
        ? "marketplace"
        : plugin.sourceKind === "installed-cache"
          ? "cache"
          : plugin.sourceKind === "user-installed"
            ? "installed"
            : "bundled",
      storageOwner: installation?.storageOwner ?? "unknown",
      manifestPath: plugin.manifestPaths[0] ?? plugin.rootPath,
      installationId: installation?.id ?? null,
      consumerIds: runtimeConsumer ? [runtimeConsumer.id] : [],
      componentInstallationIds: [],
      bundled: pluginState(plugin.bundled, mapStateEvidence(plugin.bundled), "Package belongs to a bundled catalog.", "Package is not bundled."),
      installed: pluginState(plugin.installed, mapStateEvidence(plugin.installed), "Installation evidence confirms this package is installed.", "Package is explicitly not installed."),
      enabled: pluginState(plugin.enabled, mapStateEvidence(plugin.enabled), "Runtime configuration enables this package.", "Runtime configuration disables this package."),
      loaded: pluginState(plugin.loaded, mapStateEvidence(plugin.loaded), "Runtime evidence confirms this package was loaded.", "Runtime evidence confirms this package was not loaded."),
      evidenceIds: [...new Set(plugin.evidence.map((item) => graphEvidenceByPluginId.get(item.id)).filter((id): id is string => Boolean(id)))]
    };
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function ensurePluginConsumers(discovered: DiscoveredPluginPackage[], consumers: RuntimeConsumer[]): void {
  const existing = new Set(consumers.map((consumer) => consumer.id));
  for (const runtime of new Set(discovered.map((plugin) => plugin.runtime))) {
    const id = consumerId(runtime, "global", null);
    if (existing.has(id)) continue;
    consumers.push({
      id,
      runtime,
      label: runtime === "codex" ? "Codex" : runtime === "claude" ? "Claude" : "Hermes",
      version: null,
      scope: "global",
      projectPath: null,
      configPaths: [],
      evidenceIds: []
    });
    existing.add(id);
  }
  consumers.sort((left, right) => left.id.localeCompare(right.id));
}

function summarize(assets: Asset[], canonicalSources: CanonicalSource[], installations: Installation[], bindings: Binding[], plugins: GraphPluginPackage[]): AtlasSummary {
  const summary: AtlasSummary = {
    assetCount: assets.length,
    canonicalSourceCount: canonicalSources.length,
    installationCount: installations.length,
    bindingCount: bindings.length,
    pluginCount: plugins.length,
    byType: {},
    byOwner: {},
    byScope: {}
  };
  for (const asset of assets) {
    summary.byType[asset.type] = (summary.byType[asset.type] ?? 0) + 1;
    summary.byOwner[asset.owner] = (summary.byOwner[asset.owner] ?? 0) + 1;
    summary.byScope[asset.scope] = (summary.byScope[asset.scope] ?? 0) + 1;
  }
  return summary;
}

export async function scanAtlas(options: ScanOptions = {}): Promise<Atlas> {
  const homeDir = path.resolve(options.homeDir ?? defaultHomeDir);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const warnings: string[] = [];
  const evidenceMap = new Map<string, Evidence>();
  const addEvidence = addEvidenceFactory(evidenceMap, generatedAt);
  const scanOptions = {
    desktopDir: path.resolve(options.desktopDir ?? (options.homeDir ? path.join(homeDir, "Desktop") : defaultDesktopDir)),
    explicitProjectRoots: options.explicitProjectRoots ?? defaultExplicitProjectRoots,
    skipDesktop: options.skipDesktop ?? defaultShouldSkipDesktop
  };

  const [globalCandidates, projectCandidates, skillLock, pluginDiscovery] = await Promise.all([
    collectGlobalCandidates(homeDir, warnings),
    collectDesktopProjects(scanOptions, warnings),
    readSkillLock(homeDir),
    options.discoverPlugins === false ? Promise.resolve({ packages: [] as DiscoveredPluginPackage[], warnings: [] as string[] }) : discoverPluginPackages({ homeDir })
  ]);
  if (skillLock.warning) warnings.push(skillLock.warning);
  warnings.push(...pluginDiscovery.warnings);

  const pluginCandidates: Candidate[] = pluginDiscovery.packages.map((plugin) => ({
    path: plugin.rootPath,
    projectPath: null,
    scope: plugin.sourceKind === "installed-cache" ? "cache" : "plugin",
    placementOwner: plugin.runtime,
    forceType: "plugin",
    displayName: plugin.name,
    bindings: [],
    pluginDiscoveryId: plugin.id
  }));
  const candidates = mergeCandidates([...globalCandidates, ...projectCandidates, ...pluginCandidates]);
  const scannedResults = await Promise.all(candidates.map(async (candidate): Promise<ScannedCandidate | null> => {
    try {
      return { candidate, asset: await makeAsset(candidate, homeDir, generatedAt, warnings, addEvidence) };
    } catch (error) {
      warnings.push(`Cannot inspect ${candidate.path}: ${errorCode(error)}`);
      return null;
    }
  }));
  const scanned = scannedResults.filter((item): item is ScannedCandidate => Boolean(item));
  const assets = scanned.map((item) => item.asset).sort((left, right) => left.path.localeCompare(right.path));
  const installations = buildInstallations(scanned, addEvidence);
  const canonicalSources = buildCanonicalSources(installations, assets, homeDir, skillLock.records, skillLock.path, addEvidence);
  const { consumers, bindings } = buildBindings(scanned, installations, addEvidence);
  ensurePluginConsumers(pluginDiscovery.packages, consumers);
  const pluginPackages = buildPluginPackages(pluginDiscovery.packages, scanned, installations, consumers, addEvidence);

  const atlas: Atlas = {
    schemaVersion: ATLAS_GRAPH_SCHEMA_VERSION,
    generatedAt,
    computer: { hostname: options.hostname ?? os.hostname(), home: homeDir },
    warnings: [...new Set(warnings)].sort(),
    evidence: [...evidenceMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    canonicalSources,
    installations,
    consumers,
    bindings,
    pluginPackages,
    diagnoses: [],
    agents: assets.filter((asset) => asset.type === "agent"),
    projects: assets.filter((asset) => asset.type === "project"),
    assets,
    summary: summarize(assets, canonicalSources, installations, bindings, pluginPackages)
  };
  atlas.diagnoses = evaluateDiagnoses(atlas);
  return atlas;
}
