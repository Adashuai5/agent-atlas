import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type PluginRuntime = "codex" | "claude" | "hermes";
export type PluginStateValue = "yes" | "no" | "unknown";
export type PluginSourceKind = "catalog" | "installed-cache" | "bundled" | "user-installed";
export type PluginManifestKind =
  | "codex-plugin-json"
  | "claude-plugin-json"
  | "hermes-plugin-yaml"
  | "hermes-dashboard-json";

export type PluginEvidenceKind =
  | "manifest"
  | "catalog-membership"
  | "bundled-membership"
  | "install-marker"
  | "installation-root"
  | "settings-enabled"
  | "settings-disabled"
  | "parse-error";

export interface Evidence {
  id: string;
  kind: PluginEvidenceKind;
  path: string;
  detail: string;
}

/**
 * Unknown deliberately carries no affirmative or negative evidence. Consumers
 * must not coerce it to `no` merely because an evidence array is empty.
 */
export interface EvidencedPluginState {
  value: PluginStateValue;
  evidence: Evidence[];
}

export interface PluginPackage {
  id: string;
  runtime: PluginRuntime;
  sourceKind: PluginSourceKind;
  name: string;
  version: string | null;
  description: string | null;
  author: string | null;
  marketplace: string | null;
  remotePluginId: string | null;
  rootPath: string;
  manifestPaths: string[];
  manifestKinds: PluginManifestKind[];
  valid: EvidencedPluginState;
  bundled: EvidencedPluginState;
  installed: EvidencedPluginState;
  enabled: EvidencedPluginState;
  loaded: EvidencedPluginState;
  evidence: Evidence[];
}

export interface PluginDiscoveryRoots {
  codexCatalogRoot: string | null;
  codexInstallCacheRoot: string | null;
  claudeMarketplacesRoot: string | null;
  claudeSettingsPaths: string[];
  hermesBundledRoot: string | null;
  hermesUserRoot: string | null;
  hermesConfigPath: string | null;
}

export interface PluginDiscoveryOptions {
  homeDir?: string;
  roots?: Partial<PluginDiscoveryRoots>;
}

export interface PluginDiscoveryResult {
  packages: PluginPackage[];
  warnings: string[];
}

interface ManifestMetadata {
  name: string;
  version: string | null;
  description: string | null;
  author: string | null;
}

interface ParsedManifest {
  metadata: ManifestMetadata;
  kind: PluginManifestKind;
  path: string;
  valid: EvidencedPluginState;
  evidence: Evidence[];
}

interface ClaudeEnabledSetting {
  value: boolean;
  evidence: Evidence;
}

interface HermesPluginSettings {
  enabled: Set<string>;
  disabled: Set<string>;
  configPath: string;
}

const UNKNOWN_STATE: EvidencedPluginState = { value: "unknown", evidence: [] };
const SKIP_HERMES_DIRS = new Set([".git", "__pycache__", "dist", "docs", "node_modules", "tests"]);

export function defaultPluginDiscoveryRoots(homeDir = os.homedir()): PluginDiscoveryRoots {
  return {
    codexCatalogRoot: path.join(homeDir, ".codex", ".tmp", "plugins", "plugins"),
    codexInstallCacheRoot: path.join(homeDir, ".codex", "plugins", "cache"),
    claudeMarketplacesRoot: path.join(homeDir, ".claude", "plugins", "marketplaces"),
    claudeSettingsPaths: [
      path.join(homeDir, ".claude", "settings.json"),
      path.join(homeDir, ".claude", "settings.local.json")
    ],
    hermesBundledRoot: path.join(homeDir, ".hermes", "hermes-agent", "plugins"),
    hermesUserRoot: path.join(homeDir, ".hermes", "plugins"),
    hermesConfigPath: path.join(homeDir, ".hermes", "config.yaml")
  };
}

export async function discoverPluginPackages(options: PluginDiscoveryOptions = {}): Promise<PluginDiscoveryResult> {
  const defaults = defaultPluginDiscoveryRoots(options.homeDir);
  const roots: PluginDiscoveryRoots = { ...defaults, ...options.roots };
  const warnings: string[] = [];
  const claudeSettings = await readClaudeEnabledSettings(roots.claudeSettingsPaths, warnings);
  const hermesSettings = roots.hermesConfigPath
    ? await readHermesPluginSettings(roots.hermesConfigPath, warnings)
    : emptyHermesPluginSettings("");

  const packageGroups = await Promise.all([
    roots.codexCatalogRoot ? discoverCodexCatalog(roots.codexCatalogRoot, warnings) : [],
    roots.codexInstallCacheRoot ? discoverCodexInstallCache(roots.codexInstallCacheRoot, warnings) : [],
    roots.claudeMarketplacesRoot
      ? discoverClaudeCatalog(roots.claudeMarketplacesRoot, claudeSettings, warnings)
      : [],
    roots.hermesBundledRoot ? discoverHermesBundled(roots.hermesBundledRoot, hermesSettings, warnings) : [],
    roots.hermesUserRoot ? discoverHermesUserInstalled(roots.hermesUserRoot, hermesSettings, warnings) : []
  ]);

  const packages = packageGroups.flat().sort((left, right) =>
    left.runtime.localeCompare(right.runtime)
      || left.sourceKind.localeCompare(right.sourceKind)
      || left.name.localeCompare(right.name)
      || (left.version ?? "").localeCompare(right.version ?? "")
      || left.rootPath.localeCompare(right.rootPath)
  );

  return { packages, warnings };
}

async function discoverCodexCatalog(root: string, warnings: string[]): Promise<PluginPackage[]> {
  const packages: PluginPackage[] = [];
  const seenDirectories = new Set<string>();
  for (const packageDir of await childDirectories(root, warnings, seenDirectories)) {
    const manifestPath = path.join(packageDir, ".codex-plugin", "plugin.json");
    if (!(await isFile(manifestPath))) continue;

    const manifest = await parseJsonManifest(manifestPath, "codex-plugin-json", packageDir, warnings);
    const catalogEvidence = makeEvidence(
      "catalog-membership",
      manifestPath,
      "Manifest is present in the bundled Codex plugin catalog; this does not prove installation."
    );
    packages.push(makePackage({
      runtime: "codex",
      sourceKind: "catalog",
      rootPath: packageDir,
      manifests: [manifest],
      marketplace: null,
      remotePluginId: null,
      bundled: state("yes", [catalogEvidence]),
      installed: UNKNOWN_STATE,
      enabled: UNKNOWN_STATE,
      loaded: UNKNOWN_STATE,
      extraEvidence: [catalogEvidence]
    }));
  }
  return packages;
}

async function discoverCodexInstallCache(root: string, warnings: string[]): Promise<PluginPackage[]> {
  const packages: PluginPackage[] = [];
  const seenDirectories = new Set<string>();
  for (const marketplaceDir of await childDirectories(root, warnings, seenDirectories)) {
    const marketplace = path.basename(marketplaceDir);
    for (const pluginDir of await childDirectories(marketplaceDir, warnings, seenDirectories)) {
      const markerPath = path.join(pluginDir, ".codex-remote-plugin-install.json");
      const marker = await readInstallMarker(markerPath, warnings);

      for (const versionDir of await childDirectories(pluginDir, warnings, seenDirectories)) {
        const manifestPath = path.join(versionDir, ".codex-plugin", "plugin.json");
        if (!(await isFile(manifestPath))) continue;

        const manifest = await parseJsonManifest(manifestPath, "codex-plugin-json", versionDir, warnings);
        packages.push(makePackage({
          runtime: "codex",
          sourceKind: "installed-cache",
          rootPath: versionDir,
          manifests: [manifest],
          marketplace,
          remotePluginId: marker.remotePluginId,
          bundled: UNKNOWN_STATE,
          installed: marker.state,
          enabled: UNKNOWN_STATE,
          loaded: UNKNOWN_STATE,
          extraEvidence: marker.evidence
        }));
      }
    }
  }
  return packages;
}

async function discoverClaudeCatalog(
  root: string,
  settings: Map<string, ClaudeEnabledSetting>,
  warnings: string[]
): Promise<PluginPackage[]> {
  const packages: PluginPackage[] = [];
  const seenDirectories = new Set<string>();
  for (const marketplaceDir of await childDirectories(root, warnings, seenDirectories)) {
    const marketplace = path.basename(marketplaceDir);
    for (const groupName of ["plugins", "external_plugins"]) {
      const groupDir = path.join(marketplaceDir, groupName);
      for (const packageDir of await childDirectories(groupDir, warnings, seenDirectories)) {
        const manifestPath = path.join(packageDir, ".claude-plugin", "plugin.json");
        if (!(await isFile(manifestPath))) continue;

        const manifest = await parseJsonManifest(manifestPath, "claude-plugin-json", packageDir, warnings);
        const catalogEvidence = makeEvidence(
          "catalog-membership",
          manifestPath,
          "Manifest is present in a Claude marketplace catalog; this does not prove installation."
        );
        const enabled = claudeEnabledState(manifest.metadata.name, marketplace, settings);
        packages.push(makePackage({
          runtime: "claude",
          sourceKind: "catalog",
          rootPath: packageDir,
          manifests: [manifest],
          marketplace,
          remotePluginId: null,
          bundled: state("yes", [catalogEvidence]),
          installed: UNKNOWN_STATE,
          enabled,
          loaded: UNKNOWN_STATE,
          extraEvidence: [catalogEvidence, ...enabled.evidence]
        }));
      }
    }
  }
  return packages;
}

async function collectHermesManifestPackages(root: string, warnings: string[]): Promise<Map<string, ParsedManifest[]>> {
  const manifestsByPackage = new Map<string, ParsedManifest[]>();
  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  const seenDirectories = new Set<string>();
  const rootRealpath = await realDirectoryPath(root, warnings);
  if (rootRealpath) seenDirectories.add(rootRealpath);

  while (stack.length) {
    const current = stack.pop()!;
    const entries = await directoryEntries(current.directory, warnings);
    const yamlManifests = entries.filter((entry) =>
      entry.isFile() && (entry.name === "plugin.yaml" || entry.name === "plugin.yml")
    );
    if (yamlManifests.length) {
      for (const entry of yamlManifests) {
        const entryPath = path.join(current.directory, entry.name);
        appendManifest(
          manifestsByPackage,
          current.directory,
          await parseYamlManifest(entryPath, current.directory, warnings)
        );
      }
      const dashboardManifest = path.join(current.directory, "dashboard", "manifest.json");
      if (await isFile(dashboardManifest)) {
        appendManifest(
          manifestsByPackage,
          current.directory,
          await parseJsonManifest(dashboardManifest, "hermes-dashboard-json", current.directory, warnings)
        );
      }
      // A manifest establishes the package boundary. Skills, dashboards, and
      // other component directories below it are not separate packages.
      continue;
    }
    const dashboardManifest = path.join(current.directory, "dashboard", "manifest.json");
    if (await isFile(dashboardManifest)) {
      appendManifest(
        manifestsByPackage,
        current.directory,
        await parseJsonManifest(dashboardManifest, "hermes-dashboard-json", current.directory, warnings)
      );
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current.directory, entry.name);
      if (
        current.depth < 3
        && !SKIP_HERMES_DIRS.has(entry.name)
        && !entry.name.startsWith(".")
      ) {
        const realpath = await directoryEntryRealpath(entryPath, entry, warnings);
        if (!realpath || seenDirectories.has(realpath)) continue;
        seenDirectories.add(realpath);
        stack.push({ directory: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return manifestsByPackage;
}

async function discoverHermesBundled(
  root: string,
  settings: HermesPluginSettings,
  warnings: string[]
): Promise<PluginPackage[]> {
  const manifestsByPackage = await collectHermesManifestPackages(root, warnings);
  return [...manifestsByPackage.entries()].map(([packageRoot, manifests]) => {
    const enabled = hermesEnabledState(root, packageRoot, manifests, settings);
    const bundledEvidence = makeEvidence(
      "bundled-membership",
      packageRoot,
      "Package manifest is inside the Hermes bundled plugin tree."
    );
    return makePackage({
      runtime: "hermes",
      sourceKind: "bundled",
      rootPath: packageRoot,
      manifests,
      marketplace: null,
      remotePluginId: null,
      bundled: state("yes", [bundledEvidence]),
      installed: UNKNOWN_STATE,
      enabled,
      loaded: UNKNOWN_STATE,
      extraEvidence: [bundledEvidence, ...enabled.evidence]
    });
  });
}

async function discoverHermesUserInstalled(
  root: string,
  settings: HermesPluginSettings,
  warnings: string[]
): Promise<PluginPackage[]> {
  const manifestsByPackage = await collectHermesManifestPackages(root, warnings);
  return [...manifestsByPackage.entries()].map(([packageRoot, manifests]) => {
    const enabled = hermesEnabledState(root, packageRoot, manifests, settings);
    const manifestsValid = manifests.length > 0 && manifests.every((manifest) => manifest.valid.value === "yes");
    const installationEvidence = manifestsValid
      ? makeEvidence(
        "installation-root",
        packageRoot,
        "A valid package manifest is rooted under the Hermes user plugin installation directory."
      )
      : null;
    const installed = installationEvidence ? state("yes", [installationEvidence]) : UNKNOWN_STATE;
    return makePackage({
      runtime: "hermes",
      sourceKind: "user-installed",
      rootPath: packageRoot,
      manifests,
      marketplace: null,
      remotePluginId: null,
      bundled: UNKNOWN_STATE,
      installed,
      enabled,
      loaded: UNKNOWN_STATE,
      extraEvidence: [...(installationEvidence ? [installationEvidence] : []), ...enabled.evidence]
    });
  });
}

function appendManifest(target: Map<string, ParsedManifest[]>, packageRoot: string, manifest: ParsedManifest): void {
  const manifests = target.get(packageRoot) ?? [];
  manifests.push(manifest);
  target.set(packageRoot, manifests);
}

function makePackage(input: {
  runtime: PluginRuntime;
  sourceKind: PluginSourceKind;
  rootPath: string;
  manifests: ParsedManifest[];
  marketplace: string | null;
  remotePluginId: string | null;
  bundled: EvidencedPluginState;
  installed: EvidencedPluginState;
  enabled: EvidencedPluginState;
  loaded: EvidencedPluginState;
  extraEvidence: Evidence[];
}): PluginPackage {
  const manifests = input.manifests.slice().sort((left, right) => manifestRank(left.kind) - manifestRank(right.kind));
  const primary = manifests.find((manifest) => manifest.valid.value === "yes") ?? manifests[0];
  const fallbackName = path.basename(input.rootPath);
  const validEvidence = manifests.flatMap((manifest) => manifest.valid.evidence);
  const validValue: PluginStateValue = manifests.some((manifest) => manifest.valid.value === "no")
    ? "no"
    : manifests.length > 0 && manifests.every((manifest) => manifest.valid.value === "yes")
      ? "yes"
      : "unknown";
  const manifestEvidence = manifests.flatMap((manifest) => manifest.evidence);
  const evidence = uniqueEvidence([
    ...manifestEvidence,
    ...input.extraEvidence,
    ...input.bundled.evidence,
    ...input.installed.evidence,
    ...input.enabled.evidence,
    ...input.loaded.evidence
  ]);
  const name = primary?.metadata.name || fallbackName;
  const version = primary?.metadata.version ?? inferVersionFromCachePath(input.sourceKind, input.rootPath);

  return {
    id: stableId([input.runtime, input.sourceKind, input.rootPath, name, version ?? ""]),
    runtime: input.runtime,
    sourceKind: input.sourceKind,
    name,
    version,
    description: primary?.metadata.description ?? null,
    author: primary?.metadata.author ?? null,
    marketplace: input.marketplace,
    remotePluginId: input.remotePluginId,
    rootPath: input.rootPath,
    manifestPaths: manifests.map((manifest) => manifest.path),
    manifestKinds: manifests.map((manifest) => manifest.kind),
    valid: state(validValue, validEvidence),
    bundled: input.bundled,
    installed: input.installed,
    enabled: input.enabled,
    loaded: input.loaded,
    evidence
  };
}

function manifestRank(kind: PluginManifestKind): number {
  return kind === "hermes-plugin-yaml" ? 0 : kind === "hermes-dashboard-json" ? 1 : 0;
}

function inferVersionFromCachePath(sourceKind: PluginSourceKind, rootPath: string): string | null {
  return sourceKind === "installed-cache" ? path.basename(rootPath) : null;
}

async function parseJsonManifest(
  manifestPath: string,
  kind: Extract<PluginManifestKind, "codex-plugin-json" | "claude-plugin-json" | "hermes-dashboard-json">,
  packageRoot: string,
  warnings: string[]
): Promise<ParsedManifest> {
  try {
    const text = await fs.readFile(manifestPath, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("manifest root is not an object");
    const name = nonEmptyString(parsed.name) ?? path.basename(packageRoot);
    const manifestEvidence = makeEvidence("manifest", manifestPath, `Parsed ${kind} manifest for ${name}.`);
    const hasDeclaredName = nonEmptyString(parsed.name) !== null;
    if (!hasDeclaredName) {
      const errorEvidence = makeEvidence("parse-error", manifestPath, "Manifest does not declare a non-empty name.");
      warnings.push(`Invalid plugin manifest ${manifestPath}: missing non-empty name`);
      return {
        metadata: metadataFromRecord(parsed, name),
        kind,
        path: manifestPath,
        valid: state("no", [errorEvidence]),
        evidence: [manifestEvidence, errorEvidence]
      };
    }
    return {
      metadata: metadataFromRecord(parsed, name),
      kind,
      path: manifestPath,
      valid: state("yes", [manifestEvidence]),
      evidence: [manifestEvidence]
    };
  } catch (error) {
    const detail = errorMessage(error);
    const errorEvidence = makeEvidence("parse-error", manifestPath, detail);
    warnings.push(`Cannot parse plugin manifest ${manifestPath}: ${detail}`);
    return {
      metadata: emptyMetadata(path.basename(packageRoot)),
      kind,
      path: manifestPath,
      valid: state("no", [errorEvidence]),
      evidence: [errorEvidence]
    };
  }
}

async function parseYamlManifest(manifestPath: string, packageRoot: string, warnings: string[]): Promise<ParsedManifest> {
  try {
    const text = await fs.readFile(manifestPath, "utf8");
    const parsed = parseTopLevelYamlScalars(text);
    const name = nonEmptyString(parsed.name) ?? path.basename(packageRoot);
    const manifestEvidence = makeEvidence("manifest", manifestPath, `Parsed Hermes plugin manifest for ${name}.`);
    if (!nonEmptyString(parsed.name)) {
      const errorEvidence = makeEvidence("parse-error", manifestPath, "Manifest does not declare a non-empty name.");
      warnings.push(`Invalid plugin manifest ${manifestPath}: missing non-empty name`);
      return {
        metadata: metadataFromRecord(parsed, name),
        kind: "hermes-plugin-yaml",
        path: manifestPath,
        valid: state("no", [errorEvidence]),
        evidence: [manifestEvidence, errorEvidence]
      };
    }
    return {
      metadata: metadataFromRecord(parsed, name),
      kind: "hermes-plugin-yaml",
      path: manifestPath,
      valid: state("yes", [manifestEvidence]),
      evidence: [manifestEvidence]
    };
  } catch (error) {
    const detail = errorMessage(error);
    const errorEvidence = makeEvidence("parse-error", manifestPath, detail);
    warnings.push(`Cannot parse plugin manifest ${manifestPath}: ${detail}`);
    return {
      metadata: emptyMetadata(path.basename(packageRoot)),
      kind: "hermes-plugin-yaml",
      path: manifestPath,
      valid: state("no", [errorEvidence]),
      evidence: [errorEvidence]
    };
  }
}

function parseTopLevelYamlScalars(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s/.test(line) || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (!match || !match[2]) continue;
    result[match[1]] = parseYamlScalar(match[2]);
  }
  return result;
}

function parseYamlScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Preserve the original scalar below; invalid quoting is reported only
      // when it prevents extraction of required manifest fields.
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value.replace(/\s+#.*$/, "").trim();
}

function metadataFromRecord(record: Record<string, unknown>, fallbackName: string): ManifestMetadata {
  return {
    name: nonEmptyString(record.name) ?? fallbackName,
    version: scalarString(record.version),
    description: nonEmptyString(record.description),
    author: authorName(record.author)
  };
}

function emptyMetadata(name: string): ManifestMetadata {
  return { name, version: null, description: null, author: null };
}

function authorName(value: unknown): string | null {
  if (typeof value === "string") return nonEmptyString(value);
  if (isRecord(value)) return nonEmptyString(value.name);
  return null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string") return nonEmptyString(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

async function readInstallMarker(
  markerPath: string,
  warnings: string[]
): Promise<{ state: EvidencedPluginState; remotePluginId: string | null; evidence: Evidence[] }> {
  if (!(await isFile(markerPath))) return { state: UNKNOWN_STATE, remotePluginId: null, evidence: [] };
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(markerPath, "utf8"));
    if (!isRecord(parsed)) throw new Error("install marker root is not an object");
    if (parsed.schema_version !== 1) throw new Error("install marker schema_version must equal 1");
    const remotePluginId = nonEmptyString(parsed.remote_plugin_id);
    if (!remotePluginId) throw new Error("install marker remote_plugin_id must be a non-empty string");
    const markerEvidence = makeEvidence(
      "install-marker",
      markerPath,
      `Remote installation marker ${remotePluginId}.`
    );
    return { state: state("yes", [markerEvidence]), remotePluginId, evidence: [markerEvidence] };
  } catch (error) {
    const detail = errorMessage(error);
    const errorEvidence = makeEvidence("parse-error", markerPath, detail);
    warnings.push(`Cannot parse plugin install marker ${markerPath}: ${detail}`);
    return { state: UNKNOWN_STATE, remotePluginId: null, evidence: [errorEvidence] };
  }
}

async function readClaudeEnabledSettings(
  settingsPaths: string[],
  warnings: string[]
): Promise<Map<string, ClaudeEnabledSetting>> {
  const settings = new Map<string, ClaudeEnabledSetting>();
  for (const settingsPath of settingsPaths) {
    if (!(await isFile(settingsPath))) continue;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      if (!isRecord(parsed)) throw new Error("settings root is not an object");
      const enabledPlugins = parsed.enabledPlugins;
      if (Array.isArray(enabledPlugins)) {
        for (const key of enabledPlugins) {
          if (typeof key !== "string" || !key.trim()) continue;
          setClaudeEnabledSetting(settings, key, true, settingsPath);
        }
      } else if (isRecord(enabledPlugins)) {
        for (const [key, rawValue] of Object.entries(enabledPlugins)) {
          const value = typeof rawValue === "boolean"
            ? rawValue
            : isRecord(rawValue) && typeof rawValue.enabled === "boolean"
              ? rawValue.enabled
              : null;
          if (value !== null) setClaudeEnabledSetting(settings, key, value, settingsPath);
        }
      }
    } catch (error) {
      warnings.push(`Cannot parse Claude settings ${settingsPath}: ${errorMessage(error)}`);
    }
  }
  return settings;
}

function setClaudeEnabledSetting(
  settings: Map<string, ClaudeEnabledSetting>,
  key: string,
  value: boolean,
  settingsPath: string
): void {
  const normalizedKey = key.trim().toLowerCase();
  const evidence = makeEvidence(
    value ? "settings-enabled" : "settings-disabled",
    settingsPath,
    `enabledPlugins[${JSON.stringify(key)}] is explicitly ${value}.`
  );
  // Later settings files take precedence; defaults put settings.local.json last.
  settings.set(normalizedKey, { value, evidence });
}

function claudeEnabledState(
  pluginName: string,
  marketplace: string,
  settings: Map<string, ClaudeEnabledSetting>
): EvidencedPluginState {
  const normalizedName = pluginName.trim().toLowerCase();
  const qualified = settings.get(`${normalizedName}@${marketplace.toLowerCase()}`);
  const setting = qualified ?? settings.get(normalizedName);
  return setting ? state(setting.value ? "yes" : "no", [setting.evidence]) : UNKNOWN_STATE;
}

function emptyHermesPluginSettings(configPath: string): HermesPluginSettings {
  return { enabled: new Set(), disabled: new Set(), configPath };
}

async function readHermesPluginSettings(configPath: string, warnings: string[]): Promise<HermesPluginSettings> {
  try {
    const text = await fs.readFile(configPath, "utf8");
    return parseHermesPluginSettings(text, configPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return emptyHermesPluginSettings(configPath);
    warnings.push(`Cannot parse Hermes plugin settings ${configPath}: ${errorMessage(error)}`);
    return emptyHermesPluginSettings(configPath);
  }
}

function parseHermesPluginSettings(text: string, configPath: string): HermesPluginSettings {
  const result = emptyHermesPluginSettings(configPath);
  const lines = text.split(/\r?\n/);
  let pluginsIndent: number | null = null;
  let childIndent: number | null = null;
  let activeList: { target: Set<string>; key: "enabled" | "disabled"; indent: number; items: number } | null = null;

  const finishActiveList = (): void => {
    if (!activeList) return;
    if (activeList.items === 0) throw new Error(`plugins.${activeList.key} must be a string list`);
    activeList = null;
  };

  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;
    const indentation = line.match(/^[ \t]*/)?.[0] ?? "";
    const indent = indentation.length;
    const value = line.trim();

    if (pluginsIndent === null) {
      const match = indent === 0 ? /^plugins\s*:\s*(.*)$/.exec(value) : null;
      if (!match) continue;
      if (indentation.includes("\t")) throw new Error("tabs are not valid indentation for plugins");
      const inline = match[1].trim();
      if (inline && inline !== "{}") throw new Error("plugins must be a block mapping");
      pluginsIndent = indent;
      if (inline === "{}") return result;
      continue;
    }

    if (indent <= pluginsIndent) {
      finishActiveList();
      break;
    }
    if (indentation.includes("\t")) throw new Error("tabs are not valid indentation under plugins");

    if (activeList && value.startsWith("- ") && indent >= activeList.indent) {
      const item = normalizeHermesPluginKey(parseYamlString(value.slice(2)));
      if (!item) throw new Error(`plugins.${activeList.key} contains an empty item`);
      activeList.target.add(item);
      activeList.items += 1;
      continue;
    }
    if (activeList && indent > activeList.indent) {
      throw new Error(`plugins.${activeList.key} must contain only string list items`);
    }

    finishActiveList();
    childIndent ??= indent;
    if (indent < childIndent) throw new Error("plugins contains inconsistent indentation");
    if (indent > childIndent) continue;

    const setting = /^(enabled|disabled)\s*:\s*(.*)$/.exec(value);
    if (!setting) continue;
    const key = setting[1] as "enabled" | "disabled";
    const target = key === "enabled" ? result.enabled : result.disabled;
    const inline = setting[2].trim();
    if (!inline) {
      activeList = { target, key, indent, items: 0 };
      continue;
    }
    for (const item of parseInlineYamlStringList(inline, `plugins.${key}`)) {
      const normalized = normalizeHermesPluginKey(item);
      if (!normalized) throw new Error(`plugins.${key} contains an empty item`);
      target.add(normalized);
    }
  }

  finishActiveList();
  return result;
}

function stripYamlComment(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      if (quote === character) quote = null;
      else if (!quote) quote = character;
      continue;
    }
    if (!quote && character === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function parseInlineYamlStringList(value: string, label: string): string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) throw new Error(`${label} must be an inline or block string list`);
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const values: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index <= inner.length; index += 1) {
    const character = inner[index];
    if (index === inner.length || (character === "," && !quote)) {
      const token = inner.slice(start, index).trim();
      if (!token) throw new Error(`${label} contains an empty item`);
      values.push(parseYamlString(token));
      start = index + 1;
      continue;
    }
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      if (quote === character) quote = null;
      else if (!quote) quote = character;
    }
  }
  if (quote) throw new Error(`unterminated quoted string in ${label}`);
  return values;
}

function parseYamlString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("empty YAML string");
  if (trimmed.startsWith('"')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "string") throw new Error("list item must be a string");
    return parsed;
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) throw new Error("unterminated single-quoted string");
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (
    trimmed.startsWith("[")
    || trimmed.startsWith("{")
    || /:\s/.test(trimmed)
    || /^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(trimmed)
  ) {
    throw new Error("list item must be a string");
  }
  return trimmed;
}

function normalizeHermesPluginKey(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}

function hermesEnabledState(
  sourceRoot: string,
  packageRoot: string,
  manifests: ParsedManifest[],
  settings: HermesPluginSettings
): EvidencedPluginState {
  if (!settings.configPath) return UNKNOWN_STATE;
  const packageKey = normalizeHermesPluginKey(path.relative(sourceRoot, packageRoot).split(path.sep).join("/"));
  const keys = [...new Set([
    packageKey,
    ...manifests.map((manifest) => normalizeHermesPluginKey(manifest.metadata.name))
  ].filter(Boolean))];
  const disabledKey = keys.find((key) => settings.disabled.has(key));
  if (disabledKey) {
    const evidence = makeEvidence(
      "settings-disabled",
      settings.configPath,
      `plugins.disabled explicitly lists ${JSON.stringify(disabledKey)} for Hermes package ${JSON.stringify(packageKey)}.`
    );
    return state("no", [evidence]);
  }
  const enabledKey = keys.find((key) => settings.enabled.has(key));
  if (enabledKey) {
    const evidence = makeEvidence(
      "settings-enabled",
      settings.configPath,
      `plugins.enabled explicitly lists ${JSON.stringify(enabledKey)} for Hermes package ${JSON.stringify(packageKey)}.`
    );
    return state("yes", [evidence]);
  }
  return UNKNOWN_STATE;
}

async function childDirectories(root: string, warnings: string[], seenDirectories = new Set<string>()): Promise<string[]> {
  const rootRealpath = await realDirectoryPath(root, warnings);
  if (rootRealpath) seenDirectories.add(rootRealpath);
  const entries = await directoryEntries(root, warnings);
  const directories: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const realpath = await directoryEntryRealpath(entryPath, entry, warnings);
    if (!realpath || seenDirectories.has(realpath)) continue;
    seenDirectories.add(realpath);
    directories.push(entryPath);
  }
  return directories.sort((left, right) => left.localeCompare(right));
}

async function directoryEntries(root: string, warnings: string[]): Promise<Dirent[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) warnings.push(`Cannot read plugin directory ${root}: ${errorMessage(error)}`);
    return [];
  }
}

async function realDirectoryPath(directoryPath: string, warnings: string[]): Promise<string | null> {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory() ? await fs.realpath(directoryPath) : null;
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT") && !hasErrorCode(error, "ENOTDIR")) {
      warnings.push(`Cannot inspect plugin directory ${directoryPath}: ${errorMessage(error)}`);
    }
    return null;
  }
}

async function directoryEntryRealpath(entryPath: string, entry: Dirent, warnings: string[]): Promise<string | null> {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;
  return realDirectoryPath(entryPath, warnings);
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function state(value: PluginStateValue, evidence: Evidence[]): EvidencedPluginState {
  return { value, evidence: uniqueEvidence(evidence) };
}

function makeEvidence(kind: PluginEvidenceKind, evidencePath: string, detail: string): Evidence {
  return {
    id: stableId([kind, evidencePath, detail]),
    kind,
    path: evidencePath,
    detail
  };
}

function uniqueEvidence(evidence: Evidence[]): Evidence[] {
  return [...new Map(evidence.map((item) => [item.id, item])).values()];
}

function stableId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && String(error.code) === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
