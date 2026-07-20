import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Asset } from "../src/classify.ts";
import type { Binding, Installation } from "../src/model.ts";
import { readHermesExternalDirs } from "../src/provenance.ts";
import { scanAtlas, type Atlas } from "../src/scan.ts";

const GENERATED_AT = "2026-07-17T00:00:00.000Z";

async function temporaryHome(t: TestContext, label: string): Promise<{ home: string; root: string }> {
  const canonicalTemp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(canonicalTemp, `agent-atlas-hermes-disabled-${label}-`));
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

async function writeSkill(directory: string, contents: string): Promise<void> {
  await writeText(path.join(directory, "SKILL.md"), contents);
}

async function scan(home: string): Promise<Atlas> {
  return scanAtlas({
    homeDir: home,
    skipDesktop: true,
    explicitProjectRoots: [],
    discoverPlugins: false,
    generatedAt: GENERATED_AT,
    hostname: "hermes-disabled-fixture"
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

test("Hermes skills.disabled parses inline and block lists", async (t) => {
  const fixtures = [
    {
      label: "inline",
      config: "skills:\n  disabled: [inline-one, \"inline two\", 'inline-three'] # retained comment\n",
      expected: ["inline-one", "inline two", "inline-three"]
    },
    {
      label: "block",
      // PyYAML commonly emits this valid indentless sequence style.
      config: "skills:\n  disabled:\n  - block-one\n  - \"block two\" # retained comment\n  - 'block-three'\n",
      expected: ["block-one", "block two", "block-three"]
    }
  ] as const;

  for (const fixture of fixtures) {
    const { home } = await temporaryHome(t, fixture.label);
    await writeText(path.join(home, ".hermes", "config.yaml"), fixture.config);
    const result = await readHermesExternalDirs(home);

    assert.deepEqual(result.disabled, fixture.expected);
    assert.equal(result.warning, null);
  }
});

test("malformed Hermes disabled lists fail open with a warning", async (t) => {
  const { home, root } = await temporaryHome(t, "malformed");
  const localSkill = path.join(home, ".hermes", "skills", "must-remain-unknown");
  const externalRoot = path.join(root, "external-skills");
  const configPath = path.join(home, ".hermes", "config.yaml");
  await Promise.all([
    writeSkill(localSkill, "# Valid local skill\n"),
    writeText(configPath, `skills:\n  disabled: [must-remain-unknown\n  external_dirs:\n    - ${JSON.stringify(externalRoot)}\n`)
  ]);

  const parsed = await readHermesExternalDirs(home);
  assert.deepEqual(parsed.disabled, []);
  assert.deepEqual(parsed.paths, [externalRoot]);
  assert.match(parsed.warning ?? "", /Malformed skills\.disabled value/);

  const atlas = await scan(home);
  const binding = onlyBindingFor(atlas, assetAt(atlas, localSkill));
  assert.equal(binding.enabled.value, "unknown");
  assert.equal(binding.enabled.confidence, "unknown");
  assert.deepEqual(binding.enabled.evidenceIds, []);
  assert.ok(atlas.warnings.some((warning) => warning.includes("Malformed skills.disabled value")));
});

test("Hermes external directories expand variables and resolve relative to HERMES_HOME", async (t) => {
  const { home, root } = await temporaryHome(t, "external-resolution");
  const relativeRoot = path.join(root, "relative-skills");
  const variableRoot = path.join(root, "variable-skills");
  const homeRoot = path.join(home, "home-skills");
  const variableName = "AGENT_ATLAS_HERMES_EXTERNAL_FIXTURE";
  const previous = process.env[variableName];
  process.env[variableName] = variableRoot;
  t.after(() => {
    if (previous === undefined) delete process.env[variableName];
    else process.env[variableName] = previous;
  });
  await Promise.all([relativeRoot, variableRoot, homeRoot].map((directory) => mkdir(directory, { recursive: true })));
  await writeText(path.join(home, ".hermes", "config.yaml"), `skills:\n  external_dirs: [../../relative-skills, \"\${${variableName}}\", ~/home-skills]\n`);

  const parsed = await readHermesExternalDirs(home);

  assert.deepEqual(parsed.paths, [relativeRoot, variableRoot, homeRoot]);
  assert.equal(parsed.warning, null);
});

for (const syntax of ["inline", "block"] as const) {
  test(`Hermes ${syntax} disabled config disables matching local and external Hermes bindings only`, async (t) => {
    const { home, root } = await temporaryHome(t, `integration-${syntax}`);
    const localDisabled = path.join(home, ".hermes", "skills", "category", "disabled-local");
    const localEnabled = path.join(home, ".hermes", "skills", "enabled-local");
    const externalRoot = path.join(root, "external-skills");
    const externalSameName = path.join(externalRoot, "disabled-local");
    const repositoryCopy = path.join(home, ".hermes", "hermes-agent", "skills", "disabled-local");
    const codexSameName = path.join(home, ".codex", "skills", "disabled-local");
    const configPath = path.join(home, ".hermes", "config.yaml");
    const config = syntax === "inline"
      ? `skills:\n  external_dirs: [${JSON.stringify(externalRoot)}]\n  disabled: [disabled-local]\n`
      : `skills:\n  external_dirs:\n    - ${JSON.stringify(externalRoot)}\n  disabled:\n    - disabled-local\n`;

    await Promise.all([
      writeSkill(localDisabled, "# Disabled local Hermes skill\n"),
      writeSkill(localEnabled, "# Enabled state is not observed\n"),
      writeSkill(externalSameName, "# Same name in an external Hermes directory\n"),
      writeSkill(repositoryCopy, "# Inventory-only Hermes repository copy\n"),
      writeSkill(codexSameName, "# Same name for another runtime\n"),
      writeText(configPath, config)
    ]);

    const atlas = await scan(home);
    const localAsset = assetAt(atlas, localDisabled);
    const localInstallation = installationFor(atlas, localAsset);
    const localBinding = onlyBindingFor(atlas, localAsset);
    const enabledBinding = onlyBindingFor(atlas, assetAt(atlas, localEnabled));
    const externalBinding = onlyBindingFor(atlas, assetAt(atlas, externalSameName));
    const codexBinding = onlyBindingFor(atlas, assetAt(atlas, codexSameName));
    const stateEvidence = required(
      atlas.evidence.find((evidence) => localBinding.enabled.evidenceIds.includes(evidence.id)),
      "missing explicit disabled evidence"
    );

    assert.equal(localAsset.states.present.value, true);
    assert.equal(localAsset.states.valid.value, true);
    assert.equal(localInstallation.present.value, true);
    assert.equal(localInstallation.valid.value, true);
    assert.equal(localBinding.enabled.value, false);
    assert.equal(localBinding.enabled.confidence, "confirmed");
    assert.equal(localBinding.visibility, "visible");
    assert.equal(localBinding.enabled.evidenceIds.length, 1);
    assert.equal(stateEvidence.source, "hermes-skills-disabled");
    assert.equal(stateEvidence.path, configPath);
    assert.deepEqual(stateEvidence.attributes, { runtime: "hermes", skill: "disabled-local" });
    assert.ok(localBinding.evidenceIds.includes(stateEvidence.id));

    assert.equal(enabledBinding.enabled.value, "unknown");
    assert.equal(externalBinding.enabled.value, false);
    assert.equal(externalBinding.enabled.confidence, "confirmed");
    assert.equal(codexBinding.enabled.value, "unknown");
    assert.deepEqual(assetAt(atlas, repositoryCopy).graph.bindingIds, []);
  });
}
