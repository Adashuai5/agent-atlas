import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { hashDirectory, hashFile, inspectPathIdentity } from "../src/identity.ts";

async function temporaryDirectory(t: TestContext, label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `agent-atlas-${label}-`));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function createEquivalentTrees(root: string): Promise<{ first: string; second: string }> {
  const first = path.join(root, "first");
  const second = path.join(root, "second");

  await mkdir(path.join(first, "nested"), { recursive: true });
  await writeFile(path.join(first, "z.txt"), "last by name\n");
  await writeFile(path.join(first, "nested", "a.txt"), "nested content\n");
  await writeFile(path.join(first, "a.txt"), "first by name\n");

  await mkdir(path.join(second, "nested"), { recursive: true });
  await writeFile(path.join(second, "a.txt"), "first by name\n");
  await writeFile(path.join(second, "nested", "a.txt"), "nested content\n");
  await writeFile(path.join(second, "z.txt"), "last by name\n");

  const oldTime = new Date("2001-01-01T00:00:00.000Z");
  const newTime = new Date("2031-01-01T00:00:00.000Z");
  for (const filePath of [
    path.join(first, "a.txt"),
    path.join(first, "z.txt"),
    path.join(first, "nested", "a.txt"),
    path.join(first, "nested"),
    first
  ]) {
    await utimes(filePath, oldTime, oldTime);
  }
  for (const filePath of [
    path.join(second, "a.txt"),
    path.join(second, "z.txt"),
    path.join(second, "nested", "a.txt"),
    path.join(second, "nested"),
    second
  ]) {
    await utimes(filePath, newTime, newTime);
  }

  return { first, second };
}

test("normalized directory hashes ignore creation order and mtimes", async (t) => {
  const root = await temporaryDirectory(t, "directory-order");
  const { first, second } = await createEquivalentTrees(root);

  const [firstHash, secondHash] = await Promise.all([
    hashDirectory(first),
    hashDirectory(second)
  ]);

  assert.match(firstHash, /^[a-f0-9]{64}$/);
  assert.equal(firstHash, secondHash);
});

test("normalized directory hashes change when file content changes", async (t) => {
  const root = await temporaryDirectory(t, "directory-content");
  const directory = path.join(root, "skill");
  await mkdir(directory);
  await writeFile(path.join(directory, "SKILL.md"), "version one\n");

  const before = await hashDirectory(directory);
  await writeFile(path.join(directory, "SKILL.md"), "version two\n");
  const after = await hashDirectory(directory);

  assert.notEqual(before, after);
});

test("file hashes are SHA-256 digests of file bytes", async (t) => {
  const root = await temporaryDirectory(t, "file-hash");
  const filePath = path.join(root, "config.toml");
  const contents = "model = \"atlas\"\n";
  await writeFile(filePath, contents);

  assert.equal(
    await hashFile(filePath),
    createHash("sha256").update(contents).digest("hex")
  );
});

test("symlink identity reports the resolved path and target inode", async (t) => {
  const root = await temporaryDirectory(t, "symlink");
  const target = path.join(root, "canonical", "skill");
  const installation = path.join(root, "consumer", "skills");
  const alias = path.join(installation, "skill");
  await mkdir(target, { recursive: true });
  await mkdir(installation, { recursive: true });
  await writeFile(path.join(target, "SKILL.md"), "# Shared skill\n");
  const relativeTarget = path.relative(installation, target);
  await symlink(relativeTarget, alias, "dir");

  const [identity, targetPath, targetStat, targetHash] = await Promise.all([
    inspectPathIdentity(alias),
    realpath(target),
    stat(target),
    hashDirectory(target)
  ]);

  assert.equal(identity.present, true);
  assert.equal(identity.valid, true);
  assert.equal(identity.isSymlink, true);
  assert.equal(identity.realpath, targetPath);
  assert.equal(identity.device, String(targetStat.dev));
  assert.equal(identity.inode, String(targetStat.ino));
  assert.equal(identity.contentHash, targetHash);
  assert.equal(identity.hashAlgorithm, "sha256-normalized-directory-v1");
  assert.ok(identity.linkTarget);
  assert.equal(
    await realpath(path.resolve(path.dirname(alias), identity.linkTarget)),
    targetPath
  );
});

test("broken symlinks remain present but have invalid target facts", async (t) => {
  const root = await temporaryDirectory(t, "broken-symlink");
  const alias = path.join(root, "missing-skill");
  await symlink("does-not-exist", alias, "dir");

  const identity = await inspectPathIdentity(alias);

  assert.equal(identity.present, true);
  assert.equal(identity.valid, false);
  assert.equal(identity.isSymlink, true);
  assert.equal(identity.linkTarget, "does-not-exist");
  assert.equal(identity.realpath, null);
  assert.equal(identity.device, null);
  assert.equal(identity.inode, null);
  assert.equal(identity.contentHash, null);
  assert.equal(identity.hashAlgorithm, null);
});

test("directory hashing does not follow internal symlink loops", { timeout: 2_000 }, async (t) => {
  const root = await temporaryDirectory(t, "symlink-loop");
  const directory = path.join(root, "skill");
  const nested = path.join(directory, "nested");
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), "# Loop-safe skill\n");
  await symlink("..", path.join(nested, "back"), "dir");

  const first = await hashDirectory(directory);
  const second = await hashDirectory(directory);

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});
