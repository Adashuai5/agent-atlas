import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Asset } from "../src/classify.ts";
import type { Binding, Installation, RuntimeConsumer } from "../src/model.ts";
import { scanAtlas, type Atlas } from "../src/scan.ts";

const GENERATED_AT = "2026-07-17T00:00:00.000Z";

async function temporaryHome(t: TestContext, label: string): Promise<{ home: string; root: string }> {
  const canonicalTemp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(canonicalTemp, `agent-atlas-advanced-${label}-`));
  const home = path.join(root, "home");
  await mkdir(home, { recursive: true });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return { home, root };
}

async function writeText(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSkill(directory: string, contents: string): Promise<void> {
  await writeText(path.join(directory, "SKILL.md"), contents);
}

async function scan(home: string, explicitProjectRoots: string[] = []): Promise<Atlas> {
  return scanAtlas({
    homeDir: home,
    skipDesktop: true,
    explicitProjectRoots,
    discoverPlugins: false,
    generatedAt: GENERATED_AT,
    hostname: "advanced-fixture"
  });
}

async function scanWithPlugins(home: string): Promise<Atlas> {
  return scanAtlas({
    homeDir: home,
    skipDesktop: true,
    explicitProjectRoots: [],
    discoverPlugins: true,
    generatedAt: GENERATED_AT,
    hostname: "advanced-plugin-fixture"
  });
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) assert.fail(message);
  return value;
}

function assetAt(atlas: Atlas, assetPath: string): Asset {
  return required(atlas.assets.find((asset) => asset.path === assetPath), `missing asset ${assetPath}`);
}

function installationFor(atlas: Atlas, asset: Asset): Installation {
  return required(
    atlas.installations.find((installation) => installation.id === asset.graph.installationId),
    `missing installation for ${asset.path}`
  );
}

function onlyBindingFor(atlas: Atlas, asset: Asset): Binding {
  const bindings = atlas.bindings.filter((binding) => asset.graph.bindingIds.includes(binding.id));
  assert.equal(bindings.length, 1, `expected one binding for ${asset.path}`);
  return bindings[0]!;
}

function consumerFor(atlas: Atlas, binding: Binding): RuntimeConsumer {
  return required(
    atlas.consumers.find((consumer) => consumer.id === binding.consumerId),
    `missing consumer for ${binding.id}`
  );
}

test("MCP JSON validity distinguishes malformed input from a valid object", async (t) => {
  const { home } = await temporaryHome(t, "mcp-validity");
  const mcpPath = path.join(home, ".codex", ".mcp.json");
  await writeText(mcpPath, "{ malformed json\n");

  const malformed = await scan(home);
  const malformedAsset = assetAt(malformed, mcpPath);
  const malformedInstallation = installationFor(malformed, malformedAsset);

  assert.equal(malformedAsset.type, "mcp");
  assert.equal(malformedAsset.states.present.value, true);
  assert.equal(malformedAsset.states.valid.value, false);
  assert.equal(malformedInstallation.valid.value, false);
  assert.ok(malformed.warnings.some((warning) => warning.startsWith(`Cannot parse JSON ${mcpPath}:`)));

  await writeJson(mcpPath, { mcpServers: {} });
  const valid = await scan(home);
  const validAsset = assetAt(valid, mcpPath);
  const validInstallation = installationFor(valid, validAsset);

  assert.equal(validAsset.type, "mcp");
  assert.equal(validAsset.states.present.value, true);
  assert.equal(validAsset.states.valid.value, true);
  assert.equal(validInstallation.valid.value, true);
  assert.equal(valid.warnings.some((warning) => warning.includes(`JSON ${mcpPath}`)), false);
});

test("Hermes local skill is primary over an identical hermes-agent repository copy", async (t) => {
  const { home } = await temporaryHome(t, "hermes-primary");
  const localPath = path.join(home, ".hermes", "skills", "shared-skill");
  const repositoryPath = path.join(home, ".hermes", "hermes-agent", "skills", "shared-skill");
  await Promise.all([
    writeSkill(localPath, "# Identical Hermes skill\n"),
    writeSkill(repositoryPath, "# Identical Hermes skill\n")
  ]);

  const atlas = await scan(home);
  const localInstallation = installationFor(atlas, assetAt(atlas, localPath));
  const repositoryInstallation = installationFor(atlas, assetAt(atlas, repositoryPath));

  assert.notEqual(localInstallation.id, repositoryInstallation.id);
  assert.equal(localInstallation.contentHash, repositoryInstallation.contentHash);
  assert.equal(localInstallation.canonicalSourceId, repositoryInstallation.canonicalSourceId);
  assert.equal(localInstallation.role, "primary");
  assert.equal(repositoryInstallation.role, "mirror");
  assert.equal(onlyBindingFor(atlas, assetAt(atlas, localPath)).discovery, "default-root");
  assert.deepEqual(assetAt(atlas, repositoryPath).graph.bindingIds, []);
});

test("lower-priority divergent Hermes external_dirs skill is shadowed without a conflict", async (t) => {
  const { home, root } = await temporaryHome(t, "hermes-external");
  const localPath = path.join(home, ".hermes", "skills", "same-name");
  const externalRoot = path.join(root, "external-skills");
  const externalPath = path.join(externalRoot, "same-name");
  const configPath = path.join(home, ".hermes", "config.yaml");
  await Promise.all([
    writeSkill(localPath, "# Local preferred content\n"),
    writeSkill(externalPath, "# Divergent external content\n"),
    writeText(configPath, `skills:\n  external_dirs:\n    - ${JSON.stringify(externalRoot)}\n`)
  ]);

  const atlas = await scan(home);
  const localAsset = assetAt(atlas, localPath);
  const externalAsset = assetAt(atlas, externalPath);
  const localInstallation = installationFor(atlas, localAsset);
  const externalInstallation = installationFor(atlas, externalAsset);
  const localBinding = onlyBindingFor(atlas, localAsset);
  const externalBinding = onlyBindingFor(atlas, externalAsset);

  assert.notEqual(localInstallation.contentHash, externalInstallation.contentHash);
  assert.equal(localBinding.consumerId, externalBinding.consumerId);
  assert.equal(localBinding.priority, 100);
  assert.equal(localBinding.visibility, "visible");
  assert.equal(externalBinding.discovery, "external-dir");
  assert.equal(externalBinding.priority, 50);
  assert.equal(externalBinding.visibility, "shadowed");
  assert.equal(externalBinding.shadowedByBindingId, localBinding.id);
  assert.equal(
    atlas.diagnoses.some((diagnosis) =>
      diagnosis.kind === "conflict"
      && diagnosis.installationIds.includes(localInstallation.id)
      && diagnosis.installationIds.includes(externalInstallation.id)
    ),
    false
  );
});

test("a project .codex directory symlink exposes its internal skill to the project consumer", async (t) => {
  const { home, root } = await temporaryHome(t, "project-codex-link");
  const projectPath = path.join(root, "project");
  const targetRoot = path.join(root, "shared-project-codex");
  const targetSkill = path.join(targetRoot, "skills", "linked-project-skill");
  const lexicalSkill = path.join(projectPath, ".codex", "skills", "linked-project-skill");
  await Promise.all([
    writeJson(path.join(projectPath, "package.json"), { name: "fixture-project" }),
    writeSkill(targetSkill, "# Project skill behind a directory symlink\n")
  ]);
  await symlink(targetRoot, path.join(projectPath, ".codex"), "dir");

  const atlas = await scan(home, [projectPath]);
  const asset = assetAt(atlas, lexicalSkill);
  const installation = installationFor(atlas, asset);
  const binding = onlyBindingFor(atlas, asset);
  const consumer = consumerFor(atlas, binding);
  const location = required(
    installation.locations.find((item) => item.id === asset.graph.locationId),
    "missing project lexical location"
  );

  assert.equal(asset.type, "skill");
  assert.equal(asset.projectPath, projectPath);
  assert.equal(asset.identity.realpath, await realpath(targetSkill));
  assert.equal(location.path, lexicalSkill);
  assert.equal(location.storageOwner, "project");
  assert.equal(binding.discovery, "project-root");
  assert.equal(binding.priority, 200);
  assert.equal(consumer.runtime, "codex");
  assert.equal(consumer.scope, "project");
  assert.equal(consumer.projectPath, projectPath);
});

test("global skill traversal follows a symlinked bundle category and separates lexical from target ownership", async (t) => {
  const { home } = await temporaryHome(t, "global-category-link");
  const bundleRoot = path.join(home, ".codex", "skills", "bundle");
  const targetCategory = path.join(home, ".agents", "bundles", "category");
  const targetSkill = path.join(targetCategory, "nested", "deep-skill");
  const linkedCategory = path.join(bundleRoot, "category");
  const lexicalSkill = path.join(linkedCategory, "nested", "deep-skill");
  await Promise.all([
    mkdir(bundleRoot, { recursive: true }),
    writeSkill(targetSkill, "# Deep skill in a symlinked category\n")
  ]);
  await symlink(targetCategory, linkedCategory, "dir");

  const atlas = await scan(home);
  const asset = assetAt(atlas, lexicalSkill);
  const installation = installationFor(atlas, asset);
  const binding = onlyBindingFor(atlas, asset);
  const consumer = consumerFor(atlas, binding);
  const location = required(
    installation.locations.find((item) => item.id === asset.graph.locationId),
    "missing lexical Codex location"
  );

  assert.equal(asset.type, "skill");
  assert.equal(asset.identity.realpath, await realpath(targetSkill));
  assert.equal(asset.placementOwner, "codex");
  assert.equal(asset.owner, "agents");
  assert.equal(location.path, lexicalSkill);
  assert.equal(location.storageOwner, "codex");
  assert.equal(installation.storageOwner, "agents");
  assert.equal(binding.discovery, "default-root");
  assert.equal(consumer.runtime, "codex");
  assert.equal(atlas.assets.filter((item) => item.path === lexicalSkill).length, 1);
});

test("Codex installed cache remains a cache kind and follows physical storage ownership", async (t) => {
  const { home, root } = await temporaryHome(t, "codex-cache-owner");
  const pluginRoot = path.join(home, ".codex", "plugins", "cache", "official", "cache-tool");
  const lexicalVersion = path.join(pluginRoot, "1.0.0");
  const externalVersion = path.join(root, "external-cache-tool");
  await Promise.all([
    writeJson(path.join(pluginRoot, ".codex-remote-plugin-install.json"), {
      schema_version: 1,
      remote_plugin_id: "official/cache-tool"
    }),
    writeJson(path.join(externalVersion, ".codex-plugin", "plugin.json"), {
      name: "cache-tool",
      version: "1.0.0"
    })
  ]);
  await symlink(externalVersion, lexicalVersion, "dir");

  const atlas = await scanWithPlugins(home);
  const plugin = required(atlas.pluginPackages.find((item) => item.name === "cache-tool"), "missing Codex cache plugin");
  const installation = required(atlas.installations.find((item) => item.id === plugin.installationId), "missing cache installation");

  assert.equal(plugin.kind, "cache");
  assert.equal(plugin.installed.value, true);
  assert.equal(plugin.enabled.value, "unknown");
  assert.equal(plugin.loaded.value, "unknown");
  assert.equal(plugin.storageOwner, "unknown");
  assert.equal(plugin.storageOwner, installation.storageOwner);
  assert.equal(installation.locations[0]?.path, lexicalVersion);
  assert.equal(installation.locations[0]?.isSymlink, true);
});

test("Hermes user plugin is installed, explicitly enabled, and keeps loaded unknown", async (t) => {
  const { home, root } = await temporaryHome(t, "hermes-user-plugin");
  const lexicalPlugin = path.join(home, ".hermes", "plugins", "user-tool");
  const externalPlugin = path.join(root, "external-user-tool");
  await Promise.all([
    writeText(path.join(externalPlugin, "plugin.yaml"), "name: user-tool\nversion: 2.0.0\n"),
    writeText(path.join(home, ".hermes", "config.yaml"), "plugins:\n  enabled: [user-tool]\n")
  ]);
  await mkdir(path.dirname(lexicalPlugin), { recursive: true });
  await symlink(externalPlugin, lexicalPlugin, "dir");

  const atlas = await scanWithPlugins(home);
  const plugin = required(atlas.pluginPackages.find((item) => item.name === "user-tool"), "missing Hermes user plugin");
  const installation = required(atlas.installations.find((item) => item.id === plugin.installationId), "missing user plugin installation");
  const enabledEvidence = plugin.enabled.evidenceIds.map((id) => atlas.evidence.find((item) => item.id === id));
  const installedEvidence = plugin.installed.evidenceIds.map((id) => atlas.evidence.find((item) => item.id === id));

  assert.equal(plugin.kind, "installed");
  assert.equal(plugin.bundled.value, "unknown");
  assert.equal(plugin.installed.value, true);
  assert.equal(plugin.enabled.value, true);
  assert.equal(plugin.loaded.value, "unknown");
  assert.equal(plugin.storageOwner, "unknown");
  assert.equal(plugin.storageOwner, installation.storageOwner);
  assert.ok(enabledEvidence.some((item) => item?.kind === "configuration" && item.path === path.join(home, ".hermes", "config.yaml")));
  assert.ok(installedEvidence.some((item) => item?.kind === "filesystem" && item.path === lexicalPlugin));
});
