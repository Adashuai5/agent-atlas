import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  discoverPluginPackages,
  type EvidencedPluginState,
  type PluginPackage
} from "../src/plugins.ts";

async function temporaryHome(t: TestContext, label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `agent-atlas-plugins-${label}-`));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeText(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertUnknown(state: EvidencedPluginState): void {
  assert.equal(state.value, "unknown");
  assert.deepEqual(state.evidence, []);
}

function onlyPackage(packages: PluginPackage[]): PluginPackage {
  assert.equal(packages.length, 1);
  return packages[0]!;
}

test("Codex catalog manifests are bundled but not proven installed", async (t) => {
  const home = await temporaryHome(t, "codex-catalog");
  const packageRoot = path.join(home, ".codex", ".tmp", "plugins", "plugins", "catalog-tool");
  await writeJson(path.join(packageRoot, ".codex-plugin", "plugin.json"), {
    name: "catalog-tool",
    version: "1.0.0"
  });
  await writeText(path.join(packageRoot, "skills", "internal-skill", "SKILL.md"), "# Internal skill\n");
  // Even plugin-shaped data under a package component must not become another
  // top-level package; discovery is anchored at the package manifest boundary.
  await writeJson(path.join(packageRoot, "skills", "internal-skill", ".codex-plugin", "plugin.json"), {
    name: "not-a-package"
  });

  const result = await discoverPluginPackages({ homeDir: home });
  const plugin = onlyPackage(result.packages);

  assert.deepEqual(result.warnings, []);
  assert.equal(plugin.runtime, "codex");
  assert.equal(plugin.sourceKind, "catalog");
  assert.equal(plugin.name, "catalog-tool");
  assert.equal(plugin.manifestPaths.length, 1);
  assert.equal(plugin.valid.value, "yes");
  assert.equal(plugin.bundled.value, "yes");
  assertUnknown(plugin.installed);
  assertUnknown(plugin.enabled);
  assertUnknown(plugin.loaded);
});

test("Codex cache requires a valid install marker before claiming installation", async (t) => {
  const home = await temporaryHome(t, "codex-cache");
  const cacheRoot = path.join(home, ".codex", "plugins", "cache", "remote-market");
  const installedRoot = path.join(cacheRoot, "installed-tool");
  const unmarkedRoot = path.join(cacheRoot, "unmarked-tool");

  await writeJson(path.join(installedRoot, ".codex-remote-plugin-install.json"), {
    schema_version: 1,
    remote_plugin_id: "remote-installed-tool"
  });
  await writeJson(path.join(installedRoot, "2.3.4", ".codex-plugin", "plugin.json"), {
    name: "installed-tool"
  });
  await writeJson(path.join(unmarkedRoot, "5.0.0", ".codex-plugin", "plugin.json"), {
    name: "unmarked-tool"
  });

  const result = await discoverPluginPackages({ homeDir: home });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.packages.length, 2);
  const installed = result.packages.find((plugin) => plugin.name === "installed-tool");
  const unmarked = result.packages.find((plugin) => plugin.name === "unmarked-tool");
  assert.ok(installed);
  assert.ok(unmarked);

  assert.equal(installed.installed.value, "yes");
  assert.equal(installed.remotePluginId, "remote-installed-tool");
  assert.equal(installed.version, "2.3.4");
  assert.equal(installed.installed.evidence[0]?.kind, "install-marker");
  assertUnknown(installed.bundled);
  assertUnknown(installed.enabled);
  assertUnknown(installed.loaded);

  assertUnknown(unmarked.installed);
  assert.equal(unmarked.remotePluginId, null);
  assertUnknown(unmarked.bundled);
  assertUnknown(unmarked.enabled);
  assertUnknown(unmarked.loaded);
});

test("malformed Codex install markers do not prove installation", async (t) => {
  const home = await temporaryHome(t, "codex-invalid-marker");
  const pluginRoot = path.join(home, ".codex", "plugins", "cache", "remote-market", "broken-marker");
  const markerPath = path.join(pluginRoot, ".codex-remote-plugin-install.json");
  await writeText(markerPath, "{not json\n");
  await writeJson(path.join(pluginRoot, "1.0.0", ".codex-plugin", "plugin.json"), {
    name: "broken-marker"
  });

  const result = await discoverPluginPackages({ homeDir: home });
  const plugin = onlyPackage(result.packages);

  assertUnknown(plugin.installed);
  assert.equal(plugin.remotePluginId, null);
  assert.ok(plugin.evidence.some((evidence) => evidence.kind === "parse-error" && evidence.path === markerPath));
  assert.ok(result.warnings.some((warning) => warning.includes(`Cannot parse plugin install marker ${markerPath}`)));
});

test("semantic-invalid Codex install markers do not prove installation", async (t) => {
  const home = await temporaryHome(t, "codex-semantic-marker");
  const cacheRoot = path.join(home, ".codex", "plugins", "cache", "remote-market");
  const cases = [
    { directory: "empty-marker", marker: {} },
    { directory: "wrong-schema", marker: { schema_version: 2, remote_plugin_id: "remote-wrong-schema" } },
    { directory: "missing-id", marker: { schema_version: 1 } }
  ];
  for (const fixture of cases) {
    const pluginRoot = path.join(cacheRoot, fixture.directory);
    await writeJson(path.join(pluginRoot, ".codex-remote-plugin-install.json"), fixture.marker);
    await writeJson(path.join(pluginRoot, "1.0.0", ".codex-plugin", "plugin.json"), {
      name: fixture.directory
    });
  }

  const result = await discoverPluginPackages({ homeDir: home });

  assert.equal(result.packages.length, cases.length);
  for (const plugin of result.packages) {
    assertUnknown(plugin.installed);
    assert.equal(plugin.remotePluginId, null);
    assert.ok(plugin.evidence.some((evidence) => evidence.kind === "parse-error"));
  }
  assert.equal(
    result.warnings.filter((warning) => warning.includes("Cannot parse plugin install marker")).length,
    cases.length
  );
});

test("symlinked package directories are discovered once without traversing package internals", async (t) => {
  const home = await temporaryHome(t, "symlink-packages");
  const external = path.join(home, "external-packages");

  const codexTarget = path.join(external, "codex-target");
  const codexCatalog = path.join(home, ".codex", ".tmp", "plugins", "plugins");
  await writeJson(path.join(codexTarget, ".codex-plugin", "plugin.json"), { name: "linked-codex" });
  await writeJson(path.join(codexTarget, "skills", "internal", ".codex-plugin", "plugin.json"), { name: "not-a-package" });
  await mkdir(codexCatalog, { recursive: true });
  await symlink(codexTarget, path.join(codexCatalog, "linked-codex"), "dir");
  await symlink(".", path.join(codexCatalog, "loop"), "dir");

  const claudeTarget = path.join(external, "claude-target");
  const claudeGroup = path.join(home, ".claude", "plugins", "marketplaces", "official", "plugins");
  await writeJson(path.join(claudeTarget, ".claude-plugin", "plugin.json"), { name: "linked-claude" });
  await mkdir(claudeGroup, { recursive: true });
  await symlink(claudeTarget, path.join(claudeGroup, "linked-claude"), "dir");

  const hermesTarget = path.join(external, "hermes-target");
  const hermesRoot = path.join(home, ".hermes", "hermes-agent", "plugins");
  await writeText(path.join(hermesTarget, "plugin.yaml"), "name: linked-hermes\n");
  await writeText(path.join(hermesTarget, "skills", "internal", "plugin.yaml"), "name: not-a-package\n");
  await mkdir(hermesRoot, { recursive: true });
  await symlink(hermesTarget, path.join(hermesRoot, "linked-hermes"), "dir");
  await symlink(".", path.join(hermesRoot, "loop"), "dir");

  const result = await discoverPluginPackages({ homeDir: home });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.packages.map((plugin) => plugin.name).sort(), [
    "linked-claude",
    "linked-codex",
    "linked-hermes"
  ]);
  assert.equal(result.packages.some((plugin) => plugin.name === "not-a-package"), false);
  for (const plugin of result.packages) assert.equal(plugin.manifestPaths.length, 1);
});

test("Claude marketplace settings preserve explicit enabled and disabled states", async (t) => {
  const home = await temporaryHome(t, "claude-settings");
  const marketplaceRoot = path.join(home, ".claude", "plugins", "marketplaces", "official");
  for (const name of ["enabled-tool", "disabled-tool", "unlisted-tool"]) {
    await writeJson(path.join(marketplaceRoot, "plugins", name, ".claude-plugin", "plugin.json"), {
      name,
      version: "1.0.0"
    });
  }
  await writeJson(path.join(home, ".claude", "settings.json"), {
    enabledPlugins: {
      "enabled-tool@official": true,
      "disabled-tool@official": false
    }
  });

  const result = await discoverPluginPackages({ homeDir: home });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.packages.length, 3);
  const enabled = result.packages.find((plugin) => plugin.name === "enabled-tool");
  const disabled = result.packages.find((plugin) => plugin.name === "disabled-tool");
  const unlisted = result.packages.find((plugin) => plugin.name === "unlisted-tool");
  assert.ok(enabled);
  assert.ok(disabled);
  assert.ok(unlisted);

  assert.equal(enabled.enabled.value, "yes");
  assert.equal(enabled.enabled.evidence[0]?.kind, "settings-enabled");
  assert.equal(disabled.enabled.value, "no");
  assert.equal(disabled.enabled.evidence[0]?.kind, "settings-disabled");
  assertUnknown(unlisted.enabled);
  for (const plugin of [enabled, disabled, unlisted]) {
    assert.equal(plugin.runtime, "claude");
    assert.equal(plugin.bundled.value, "yes");
    assertUnknown(plugin.installed);
    assertUnknown(plugin.loaded);
  }
});

test("Hermes package manifests are bundled without inferring enablement or loading", async (t) => {
  const home = await temporaryHome(t, "hermes-bundled");
  const packageRoot = path.join(home, ".hermes", "hermes-agent", "plugins", "memory", "memory-tool");
  await writeText(path.join(packageRoot, "plugin.yaml"), [
    "name: memory-tool",
    "version: 3.1.0",
    "description: Fixture plugin"
  ].join("\n"));
  await writeJson(path.join(packageRoot, "dashboard", "manifest.json"), {
    name: "memory-tool",
    version: "3.1.0"
  });
  await writeText(path.join(packageRoot, "skills", "helper", "SKILL.md"), "# Component, not package\n");
  await writeText(path.join(packageRoot, "skills", "helper", "plugin.yaml"), "name: nested-component\n");

  const result = await discoverPluginPackages({ homeDir: home });
  const plugin = onlyPackage(result.packages);

  assert.deepEqual(result.warnings, []);
  assert.equal(plugin.runtime, "hermes");
  assert.equal(plugin.sourceKind, "bundled");
  assert.equal(plugin.name, "memory-tool");
  assert.equal(plugin.manifestPaths.length, 2);
  assert.equal(result.packages.some((item) => item.name === "nested-component"), false);
  assert.equal(plugin.valid.value, "yes");
  assert.equal(plugin.bundled.value, "yes");
  assertUnknown(plugin.installed);
  assertUnknown(plugin.enabled);
  assertUnknown(plugin.loaded);
});

test("Hermes user plugins support flat, category, and symlinked manifest packages", async (t) => {
  const home = await temporaryHome(t, "hermes-user-packages");
  const userRoot = path.join(home, ".hermes", "plugins");
  const flatRoot = path.join(userRoot, "flat-tool");
  const externalCategory = path.join(home, "external-plugin-category");
  const linkedRoot = path.join(userRoot, "category", "linked-tool");
  await writeText(path.join(flatRoot, "plugin.yaml"), "name: flat-tool\nversion: 1.0.0\n");
  await writeText(path.join(flatRoot, "skills", "component", "plugin.yaml"), "name: not-a-package\n");
  await writeText(path.join(externalCategory, "linked-tool", "plugin.yaml"), "name: linked-tool\nversion: 2.0.0\n");
  await mkdir(userRoot, { recursive: true });
  await symlink(externalCategory, path.join(userRoot, "category"), "dir");

  const result = await discoverPluginPackages({ homeDir: home });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.packages.map((plugin) => plugin.name).sort(), ["flat-tool", "linked-tool"]);
  assert.equal(result.packages.some((plugin) => plugin.name === "not-a-package"), false);
  for (const plugin of result.packages) {
    assert.equal(plugin.runtime, "hermes");
    assert.equal(plugin.sourceKind, "user-installed");
    assert.equal(plugin.valid.value, "yes");
    assert.equal(plugin.installed.value, "yes");
    assert.equal(plugin.installed.evidence[0]?.kind, "installation-root");
    assertUnknown(plugin.bundled);
    assertUnknown(plugin.enabled);
    assertUnknown(plugin.loaded);
  }
  assert.equal(result.packages.find((plugin) => plugin.name === "linked-tool")?.rootPath, linkedRoot);
});

test("Hermes plugins.enabled and plugins.disabled match package keys or manifest names", async (t) => {
  const home = await temporaryHome(t, "hermes-settings");
  const bundledRoot = path.join(home, ".hermes", "hermes-agent", "plugins");
  const userRoot = path.join(home, ".hermes", "plugins");
  const configPath = path.join(home, ".hermes", "config.yaml");
  await writeText(
    path.join(bundledRoot, "providers", "bundled-dir", "plugin.yaml"),
    "name: bundled-manifest-name\n"
  );
  await writeText(
    path.join(userRoot, "category", "enabled-by-key", "plugin.yaml"),
    "name: renamed-user-plugin\n"
  );
  await writeText(
    path.join(userRoot, "disabled-dir", "plugin.yaml"),
    "name: disabled-by-manifest\n"
  );
  await writeText(path.join(userRoot, "both", "plugin.yaml"), "name: both\n");
  await writeText(path.join(userRoot, "unlisted", "plugin.yaml"), "name: unlisted\n");
  await writeText(configPath, [
    "plugins:",
    "  enabled: [category/enabled-by-key, \"bundled-manifest-name\", both]",
    "  disabled:",
    "    - disabled-by-manifest",
    "    - both"
  ].join("\n"));

  const result = await discoverPluginPackages({ homeDir: home });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.packages.length, 5);
  const bundled = result.packages.find((plugin) => plugin.name === "bundled-manifest-name");
  const enabledByKey = result.packages.find((plugin) => plugin.name === "renamed-user-plugin");
  const disabledByName = result.packages.find((plugin) => plugin.name === "disabled-by-manifest");
  const both = result.packages.find((plugin) => plugin.name === "both");
  const unlisted = result.packages.find((plugin) => plugin.name === "unlisted");
  assert.ok(bundled);
  assert.ok(enabledByKey);
  assert.ok(disabledByName);
  assert.ok(both);
  assert.ok(unlisted);

  assert.equal(bundled.sourceKind, "bundled");
  assert.equal(bundled.enabled.value, "yes");
  assert.equal(bundled.enabled.evidence[0]?.kind, "settings-enabled");
  assert.equal(enabledByKey.enabled.value, "yes");
  assert.equal(enabledByKey.enabled.evidence[0]?.kind, "settings-enabled");
  assert.equal(disabledByName.enabled.value, "no");
  assert.equal(disabledByName.enabled.evidence[0]?.kind, "settings-disabled");
  assert.equal(both.enabled.value, "no", "plugins.disabled must take precedence");
  assert.equal(both.enabled.evidence[0]?.kind, "settings-disabled");
  assertUnknown(unlisted.enabled);
  for (const plugin of result.packages) assertUnknown(plugin.loaded);
});

test("Hermes plugin settings accept PyYAML indentless block lists", async (t) => {
  const home = await temporaryHome(t, "hermes-indentless-settings");
  const userRoot = path.join(home, ".hermes", "plugins");
  for (const name of ["enabled-tool", "disabled-tool", "unlisted-tool"]) {
    await writeText(path.join(userRoot, name, "plugin.yaml"), `name: ${name}\n`);
  }
  await writeText(path.join(home, ".hermes", "config.yaml"), [
    "plugins:",
    "  enabled:",
    "  - enabled-tool",
    "  - disabled-tool",
    "  disabled:",
    "  - disabled-tool"
  ].join("\n"));

  const result = await discoverPluginPackages({ homeDir: home });
  assert.deepEqual(result.warnings, []);
  const enabled = result.packages.find((plugin) => plugin.name === "enabled-tool");
  const disabled = result.packages.find((plugin) => plugin.name === "disabled-tool");
  const unlisted = result.packages.find((plugin) => plugin.name === "unlisted-tool");
  assert.ok(enabled);
  assert.ok(disabled);
  assert.ok(unlisted);
  assert.equal(enabled.enabled.value, "yes");
  assert.equal(disabled.enabled.value, "no", "indentless disabled must still take precedence");
  assertUnknown(unlisted.enabled);
});

test("Hermes plugin config matching preserves runtime case sensitivity", async (t) => {
  const home = await temporaryHome(t, "hermes-case-sensitive-settings");
  await writeText(path.join(home, ".hermes", "plugins", "case-tool", "plugin.yaml"), "name: case-tool\n");
  await writeText(path.join(home, ".hermes", "config.yaml"), "plugins:\n  enabled: [CASE-TOOL]\n");

  const result = await discoverPluginPackages({ homeDir: home });
  const plugin = onlyPackage(result.packages);

  assertUnknown(plugin.enabled);
});

test("malformed Hermes plugin settings fail open with a warning", async (t) => {
  const home = await temporaryHome(t, "hermes-malformed-settings");
  const packageRoot = path.join(home, ".hermes", "plugins", "user-tool");
  const configPath = path.join(home, ".hermes", "config.yaml");
  await writeText(path.join(packageRoot, "plugin.yaml"), "name: user-tool\n");
  await writeText(configPath, "plugins:\n  enabled: user-tool\n");

  const result = await discoverPluginPackages({ homeDir: home });
  const plugin = onlyPackage(result.packages);

  assert.equal(plugin.sourceKind, "user-installed");
  assert.equal(plugin.installed.value, "yes");
  assertUnknown(plugin.enabled);
  assertUnknown(plugin.loaded);
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith(`Cannot parse Hermes plugin settings ${configPath}:`)
  ));
});

test("an invalid Hermes user manifest does not prove installation", async (t) => {
  const home = await temporaryHome(t, "hermes-invalid-user-manifest");
  const packageRoot = path.join(home, ".hermes", "plugins", "invalid-user-tool");
  await writeText(path.join(packageRoot, "plugin.yaml"), "version: 1.0.0\n");

  const result = await discoverPluginPackages({ homeDir: home });
  const plugin = onlyPackage(result.packages);

  assert.equal(plugin.sourceKind, "user-installed");
  assert.equal(plugin.valid.value, "no");
  assertUnknown(plugin.installed);
  assertUnknown(plugin.bundled);
  assertUnknown(plugin.enabled);
  assertUnknown(plugin.loaded);
});

test("invalid package manifests remain visible and emit a warning", async (t) => {
  const home = await temporaryHome(t, "invalid-manifest");
  const packageRoot = path.join(home, ".codex", ".tmp", "plugins", "plugins", "unnamed-tool");
  const manifestPath = path.join(packageRoot, ".codex-plugin", "plugin.json");
  await writeJson(manifestPath, { version: "1.0.0" });

  const result = await discoverPluginPackages({ homeDir: home });
  const plugin = onlyPackage(result.packages);

  assert.equal(plugin.name, "unnamed-tool");
  assert.equal(plugin.valid.value, "no");
  assert.equal(plugin.valid.evidence[0]?.kind, "parse-error");
  assert.ok(result.warnings.some((warning) => warning === `Invalid plugin manifest ${manifestPath}: missing non-empty name`));
  assertUnknown(plugin.installed);
  assertUnknown(plugin.enabled);
  assertUnknown(plugin.loaded);
});
