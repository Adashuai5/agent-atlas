import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ContentHashAlgorithm, PathIdentity } from "./model.ts";

export const FILE_HASH_ALGORITHM: ContentHashAlgorithm = "sha256-file-v1";
export const DIRECTORY_HASH_ALGORITHM: ContentHashAlgorithm = "sha256-normalized-directory-v1";

export const DEFAULT_IGNORED_DIRECTORY_ENTRIES = new Set([
  ".git",
  ".DS_Store",
  "node_modules",
  "__pycache__"
]);

export interface DirectoryHashOptions {
  ignoredNames?: ReadonlySet<string> | readonly string[];
}

function normalizedRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function appendRecord(hash: ReturnType<typeof createHash>, kind: string, relativePath: string, payload: string): void {
  const fields = [kind, normalizedRelativePath(relativePath), payload];
  for (const field of fields) {
    hash.update(String(Buffer.byteLength(field)), "utf8");
    hash.update(":", "utf8");
    hash.update(field, "utf8");
    hash.update("\0", "utf8");
  }
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function hashDirectory(directoryPath: string, options: DirectoryHashOptions = {}): Promise<string> {
  const ignoredNames = new Set(options.ignoredNames ?? DEFAULT_IGNORED_DIRECTORY_ENTRIES);
  const hash = createHash("sha256");
  const seenDirectories = new Set<string>();
  hash.update(`${DIRECTORY_HASH_ALGORITHM}\0`, "utf8");

  async function walk(currentPath: string, relativeDirectory: string): Promise<void> {
    const currentStat = await fs.lstat(currentPath);
    const physicalId = `${currentStat.dev}:${currentStat.ino}`;
    if (seenDirectories.has(physicalId)) {
      appendRecord(hash, "cycle", relativeDirectory, physicalId);
      return;
    }
    seenDirectories.add(physicalId);

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      if (ignoredNames.has(entry.name)) continue;
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const stat = await fs.lstat(entryPath);

      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(entryPath);
        appendRecord(hash, "symlink", relativePath, normalizedRelativePath(target));
      } else if (stat.isDirectory()) {
        appendRecord(hash, "directory", relativePath, "");
        await walk(entryPath, relativePath);
      } else if (stat.isFile()) {
        appendRecord(hash, "file", relativePath, await hashFile(entryPath));
      } else {
        appendRecord(hash, "other", relativePath, "");
      }
    }
  }

  await walk(directoryPath, "");
  return hash.digest("hex");
}

function emptyIdentity(overrides: Partial<PathIdentity> = {}): PathIdentity {
  return {
    present: false,
    valid: false,
    isSymlink: false,
    linkTarget: null,
    realpath: null,
    device: null,
    inode: null,
    sizeBytes: null,
    modifiedAt: null,
    contentHash: null,
    hashAlgorithm: null,
    ...overrides
  };
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error ? String(error.code) : null;
}

export async function inspectPathIdentity(filePath: string): Promise<PathIdentity> {
  let lexicalStat;
  try {
    lexicalStat = await fs.lstat(filePath);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) return emptyIdentity();
    throw error;
  }

  const isSymlink = lexicalStat.isSymbolicLink();
  const linkTarget = isSymlink ? await fs.readlink(filePath) : null;

  let resolvedPath: string;
  let resolvedStat;
  try {
    resolvedPath = await fs.realpath(filePath);
    resolvedStat = await fs.stat(resolvedPath);
  } catch {
    return emptyIdentity({ present: true, isSymlink, linkTarget });
  }

  let contentHash: string | null = null;
  let hashAlgorithm: ContentHashAlgorithm | null = null;
  try {
    if (resolvedStat.isFile()) {
      contentHash = await hashFile(resolvedPath);
      hashAlgorithm = FILE_HASH_ALGORITHM;
    } else if (resolvedStat.isDirectory()) {
      contentHash = await hashDirectory(resolvedPath);
      hashAlgorithm = DIRECTORY_HASH_ALGORITHM;
    }
  } catch {
    // Identity remains valid even when permissions or a concurrent mutation
    // prevent content hashing; callers can emit separate scan evidence.
  }

  return {
    present: true,
    valid: true,
    isSymlink,
    linkTarget,
    realpath: resolvedPath,
    device: String(resolvedStat.dev),
    inode: String(resolvedStat.ino),
    sizeBytes: resolvedStat.size,
    modifiedAt: resolvedStat.mtime.toISOString(),
    contentHash,
    hashAlgorithm
  };
}
