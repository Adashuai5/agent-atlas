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
import { scanAtlas, type Atlas } from "../src/scan.ts";

const GENERATED_AT = "2026-07-17T00:00:00.000Z";

async function temporaryRoot(t: TestContext): Promise<string> {
  const canonicalTemp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(canonicalTemp, "agent-atlas-scan-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function writeSkill(directory: string, contents: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), contents);
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) assert.fail(message);
  return value;
}

function assertEvidenceReferences(atlas: Atlas, ids: string[], label: string): void {
  const evidenceIds = new Set(atlas.evidence.map((item) => item.id));
  for (const id of ids) {
    assert.ok(evidenceIds.has(id), `${label} references missing evidence ${id}`);
  }
}

function assertReferentialIntegrity(atlas: Atlas): void {
  const canonicalSourceIds = new Set(atlas.canonicalSources.map((item) => item.id));
  const installationIds = new Set(atlas.installations.map((item) => item.id));
  const consumerIds = new Set(atlas.consumers.map((item) => item.id));
  const bindingIds = new Set(atlas.bindings.map((item) => item.id));
  const pluginPackageIds = new Set(atlas.pluginPackages.map((item) => item.id));
  const locations = new Map(atlas.installations.flatMap((installation) =>
    installation.locations.map((location) => [location.id, { installation, location }] as const)
  ));

  for (const source of atlas.canonicalSources) {
    assertEvidenceReferences(atlas, source.evidenceIds, `canonical source ${source.id}`);
  }

  for (const installation of atlas.installations) {
    if (installation.canonicalSourceId) {
      assert.ok(
        canonicalSourceIds.has(installation.canonicalSourceId),
        `installation ${installation.id} references a missing canonical source`
      );
    }
    if (installation.pluginPackageId) {
      assert.ok(
        pluginPackageIds.has(installation.pluginPackageId),
        `installation ${installation.id} references a missing plugin package`
      );
    }
    assertEvidenceReferences(atlas, installation.evidenceIds, `installation ${installation.id}`);
    assertEvidenceReferences(atlas, installation.present.evidenceIds, `installation ${installation.id} present state`);
    assertEvidenceReferences(atlas, installation.valid.evidenceIds, `installation ${installation.id} valid state`);
    for (const location of installation.locations) {
      assertEvidenceReferences(atlas, location.evidenceIds, `location ${location.id}`);
    }
  }

  for (const consumer of atlas.consumers) {
    assertEvidenceReferences(atlas, consumer.evidenceIds, `consumer ${consumer.id}`);
  }

  for (const binding of atlas.bindings) {
    assert.ok(installationIds.has(binding.installationId), `binding ${binding.id} has no installation`);
    assert.ok(consumerIds.has(binding.consumerId), `binding ${binding.id} has no consumer`);
    if (binding.viaLocationId) {
      const referenced = required(locations.get(binding.viaLocationId), `binding ${binding.id} has no location`);
      assert.equal(
        referenced.installation.id,
        binding.installationId,
        `binding ${binding.id} location belongs to another installation`
      );
    }
    assertEvidenceReferences(atlas, binding.evidenceIds, `binding ${binding.id}`);
    assertEvidenceReferences(atlas, binding.enabled.evidenceIds, `binding ${binding.id} enabled state`);
    assertEvidenceReferences(atlas, binding.loaded.evidenceIds, `binding ${binding.id} loaded state`);
  }

  for (const plugin of atlas.pluginPackages) {
    if (plugin.installationId) assert.ok(installationIds.has(plugin.installationId));
    plugin.consumerIds.forEach((id) => assert.ok(consumerIds.has(id)));
    plugin.componentInstallationIds.forEach((id) => assert.ok(installationIds.has(id)));
    assertEvidenceReferences(atlas, plugin.evidenceIds, `plugin ${plugin.id}`);
    for (const [name, state] of Object.entries({
      bundled: plugin.bundled,
      installed: plugin.installed,
      enabled: plugin.enabled,
      loaded: plugin.loaded
    })) {
      assertEvidenceReferences(atlas, state.evidenceIds, `plugin ${plugin.id} ${name} state`);
    }
  }

  for (const asset of atlas.assets) {
    assertEvidenceReferences(atlas, asset.states.present.evidenceIds, `asset ${asset.id} present state`);
    assertEvidenceReferences(atlas, asset.states.valid.evidenceIds, `asset ${asset.id} valid state`);
    if (asset.graph.canonicalSourceId) assert.ok(canonicalSourceIds.has(asset.graph.canonicalSourceId));
    if (asset.graph.installationId) assert.ok(installationIds.has(asset.graph.installationId));
    if (asset.graph.locationId) {
      const referenced = required(locations.get(asset.graph.locationId), `asset ${asset.id} has no location`);
      assert.equal(referenced.installation.id, asset.graph.installationId);
    }
    asset.graph.bindingIds.forEach((id) => assert.ok(bindingIds.has(id)));
    if (asset.graph.pluginPackageId) assert.ok(pluginPackageIds.has(asset.graph.pluginPackageId));
  }

  for (const diagnosis of atlas.diagnoses) {
    if (diagnosis.consumerId) assert.ok(consumerIds.has(diagnosis.consumerId));
    diagnosis.canonicalSourceIds.forEach((id) => assert.ok(canonicalSourceIds.has(id)));
    diagnosis.installationIds.forEach((id) => assert.ok(installationIds.has(id)));
    diagnosis.bindingIds.forEach((id) => assert.ok(bindingIds.has(id)));
    diagnosis.pluginPackageIds.forEach((id) => assert.ok(pluginPackageIds.has(id)));
    assertEvidenceReferences(atlas, diagnosis.evidenceIds, `diagnosis ${diagnosis.id}`);
  }
}

test("scanAtlas preserves storage provenance, runtime bindings, and graph integrity", async (t) => {
  const root = await temporaryRoot(t);
  const home = path.join(root, "home");
  const agentsShared = path.join(home, ".agents", "skills", "shared");
  const claudeShared = path.join(home, ".claude", "skills", "shared");
  const externalSkill = path.join(root, "external-fixture", "external");
  const codexExternal = path.join(home, ".codex", "skills", "external");
  const hermesCodex = path.join(home, ".hermes", "skills", "autonomous", "codex");
  const hermesDemo = path.join(home, ".hermes", "skills", "demo");
  const templateClaude = path.join(hermesDemo, "templates", "claude.md");
  const skillLockPath = path.join(home, ".agents", ".skill-lock.json");

  await Promise.all([
    writeSkill(agentsShared, "# Shared skill\n"),
    writeSkill(externalSkill, "# External skill\n"),
    writeSkill(hermesCodex, "# Hermes nested Codex skill\n"),
    writeSkill(hermesDemo, "# Hermes demo skill\n"),
    mkdir(path.dirname(claudeShared), { recursive: true }),
    mkdir(path.dirname(codexExternal), { recursive: true })
  ]);
  await mkdir(path.dirname(templateClaude), { recursive: true });
  await writeFile(templateClaude, "# Template only; not runtime memory\n");
  await Promise.all([
    symlink(path.relative(path.dirname(claudeShared), agentsShared), claudeShared, "dir"),
    symlink(externalSkill, codexExternal, "dir")
  ]);
  await writeFile(skillLockPath, JSON.stringify({
    version: 3,
    dismissed: [],
    lastSelectedAgents: [],
    skills: {
      shared: {
        source: "example/shared-skill",
        sourceType: "github",
        sourceUrl: "https://github.com/example/shared-skill.git",
        skillPath: "shared/SKILL.md",
        skillFolderHash: "upstream-folder-hash",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z"
      }
    }
  }, null, 2));

  const atlas = await scanAtlas({
    homeDir: home,
    skipDesktop: true,
    explicitProjectRoots: [],
    discoverPlugins: false,
    generatedAt: GENERATED_AT,
    hostname: "fixture-host"
  });

  await t.test("relative and absolute skill symlinks are both discovered", async () => {
    const claudeAlias = required(
      atlas.assets.find((asset) => asset.path === claudeShared),
      "Claude shared-skill symlink was not scanned"
    );
    const codexAlias = required(
      atlas.assets.find((asset) => asset.path === codexExternal),
      "Codex external-skill symlink was not scanned"
    );

    assert.equal(claudeAlias.type, "skill");
    assert.equal(claudeAlias.identity.isSymlink, true);
    assert.equal(claudeAlias.identity.realpath, await realpath(agentsShared));
    assert.equal(codexAlias.type, "skill");
    assert.equal(codexAlias.identity.isSymlink, true);
    assert.equal(codexAlias.identity.realpath, await realpath(externalSkill));
  });

  await t.test("Claude alias retains Agents storage ownership and a Claude consumer", () => {
    const aliasAsset = required(atlas.assets.find((asset) => asset.path === claudeShared), "missing Claude alias asset");
    const installation = required(
      atlas.installations.find((item) => item.id === aliasAsset.graph.installationId),
      "missing shared installation"
    );
    const aliasLocation = required(
      installation.locations.find((location) => location.id === aliasAsset.graph.locationId),
      "missing Claude alias location"
    );
    const aliasBinding = required(
      atlas.bindings.find((item) => aliasAsset.graph.bindingIds.includes(item.id)),
      "missing Claude alias binding"
    );
    const runtime = required(
      atlas.consumers.find((item) => item.id === aliasBinding.consumerId),
      "missing Claude consumer"
    );

    assert.equal(aliasAsset.placementOwner, "claude");
    assert.equal(aliasAsset.owner, "agents");
    assert.equal(installation.storageOwner, "agents");
    assert.equal(installation.locations.length, 2);
    assert.equal(aliasLocation.kind, "symlink");
    assert.equal(aliasLocation.storageOwner, "claude");
    assert.equal(runtime.runtime, "claude");
  });

  await t.test("absolute external target is unknown storage with a Codex consumer", () => {
    const asset = required(atlas.assets.find((item) => item.path === codexExternal), "missing external asset");
    const installation = required(
      atlas.installations.find((item) => item.id === asset.graph.installationId),
      "missing external installation"
    );
    const runtime = required(
      atlas.consumers.find((consumer) =>
        atlas.bindings.some((binding) =>
          asset.graph.bindingIds.includes(binding.id) && binding.consumerId === consumer.id
        )
      ),
      "missing Codex consumer for external skill"
    );

    assert.equal(asset.placementOwner, "codex");
    assert.equal(asset.owner, "unknown");
    assert.equal(installation.storageOwner, "unknown");
    assert.equal(runtime.runtime, "codex");
  });

  await t.test("Hermes nested codex directory remains Hermes-owned and Hermes-consumed", () => {
    const asset = required(atlas.assets.find((item) => item.path === hermesCodex), "missing nested Hermes skill");
    const binding = required(
      atlas.bindings.find((item) => asset.graph.bindingIds.includes(item.id)),
      "missing Hermes binding"
    );
    const runtime = required(
      atlas.consumers.find((item) => item.id === binding.consumerId),
      "missing Hermes consumer"
    );

    assert.equal(asset.name, "codex");
    assert.equal(asset.owner, "hermes");
    assert.equal(asset.placementOwner, "hermes");
    assert.equal(runtime.runtime, "hermes");
  });

  await t.test("template claude.md remains content inside a skill, not a standalone asset", () => {
    assert.equal(atlas.assets.some((asset) => asset.path === templateClaude), false);
    assert.equal(atlas.assets.some((asset) => asset.name.toLowerCase() === "claude.md"), false);
    assert.ok(atlas.assets.some((asset) => asset.path === hermesDemo && asset.type === "skill"));
  });

  await t.test("skill-lock v3 establishes canonical source provenance", () => {
    const sharedAsset = required(atlas.assets.find((asset) => asset.path === agentsShared), "missing shared asset");
    const source = required(
      atlas.canonicalSources.find((item) => item.id === sharedAsset.graph.canonicalSourceId),
      "missing canonical source for shared skill"
    );
    const lockEvidence = source.evidenceIds
      .map((id) => atlas.evidence.find((item) => item.id === id))
      .find((item) => item?.kind === "skill-lock");

    assert.equal(source.confidence, "confirmed");
    assert.equal(source.source, "example/shared-skill");
    assert.equal(source.sourceType, "github");
    assert.equal(source.sourceUrl, "https://github.com/example/shared-skill.git");
    assert.equal(source.sourcePath, "shared/SKILL.md");
    assert.equal(source.expectedContentHash, "upstream-folder-hash");
    assert.equal(lockEvidence?.path, skillLockPath);
    assert.equal(lockEvidence?.source, "skill-lock-v3");
  });

  await t.test("presence, validity, enablement, and loading remain distinct", () => {
    const asset = required(atlas.assets.find((item) => item.path === codexExternal), "missing external asset");
    const installation = required(
      atlas.installations.find((item) => item.id === asset.graph.installationId),
      "missing external installation"
    );
    const binding = required(
      atlas.bindings.find((item) => asset.graph.bindingIds.includes(item.id)),
      "missing external binding"
    );

    assert.equal(asset.states.present.value, true);
    assert.equal(asset.states.valid.value, true);
    assert.equal(installation.present.value, true);
    assert.equal(installation.valid.value, true);
    assert.equal(binding.visibility, "visible");
    assert.equal(binding.enabled.value, "unknown");
    assert.deepEqual(binding.enabled.evidenceIds, []);
    assert.equal(binding.loaded.value, "unknown");
    assert.equal(binding.loaded.confidence, "unknown");
    assert.deepEqual(binding.loaded.evidenceIds, []);
  });

  await t.test("all graph and evidence references resolve", () => {
    assertReferentialIntegrity(atlas);
  });
});
