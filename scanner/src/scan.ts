import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { classifyType, detectOwner, detectScope } from "./classify.ts";
import type { Asset, Signals } from "./classify.ts";
import { desktopDir, explicitProjectRoots, globalRoots, projectConfigNames, shouldSkipDesktop, skipDirNames } from "./paths.ts";

export interface Atlas {
  generatedAt: string;
  computer: {
    hostname: string;
    home: string;
  };
  warnings: string[];
  agents: Asset[];
  projects: Asset[];
  assets: Asset[];
  summary: {
    assetCount: number;
    byType: Record<string, number>;
    byOwner: Record<string, number>;
    byScope: Record<string, number>;
  };
}

interface Candidate {
  path: string;
  projectPath: string | null;
  forceType?: Asset["type"];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function listDir(filePath: string) {
  try {
    return await fs.readdir(filePath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function listDirWithWarning(filePath: string, warnings: string[]) {
  try {
    return await fs.readdir(filePath, { withFileTypes: true });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
    warnings.push(`Cannot read ${filePath}: ${code}`);
    return [];
  }
}

function stableId(filePath: string): string {
  return crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16);
}

async function dirSizeAndCount(filePath: string, maxEntries = 400): Promise<{ sizeBytes: number; childCount: number }> {
  let sizeBytes = 0;
  let childCount = 0;
  const stack = [filePath];

  while (stack.length && childCount < maxEntries) {
    const current = stack.pop()!;
    const entries = await listDir(current);
    for (const entry of entries) {
      if (skipDirNames.has(entry.name)) continue;
      const entryPath = path.join(current, entry.name);
      const stat = await safeStat(entryPath);
      if (!stat) continue;
      childCount += 1;
      sizeBytes += stat.size;
      if (entry.isDirectory()) stack.push(entryPath);
      if (childCount >= maxEntries) break;
    }
  }

  return { sizeBytes, childCount };
}

async function buildSignals(filePath: string, isDirectory: boolean): Promise<Signals> {
  const signals: Signals = { isDirectory };
  if (isDirectory) {
    const entries = await listDir(filePath);
    const names = new Set(entries.map((entry) => entry.name));
    signals.hasSkillMd = names.has("SKILL.md");
    signals.hasReadme = names.has("README.md");
    signals.hasMcpConfig = names.has(".mcp.json");
    signals.childCount = entries.length;
    if (["sessions", "history"].includes(path.basename(filePath).toLowerCase())) {
      signals.sessionCount = entries.length;
    }
  }
  return signals;
}

async function makeAsset(candidate: Candidate): Promise<Asset | null> {
  const stat = await safeStat(candidate.path);
  if (!stat) return null;

  const isDirectory = stat.isDirectory();
  const signals = await buildSignals(candidate.path, isDirectory);
  const sizeInfo = isDirectory ? await dirSizeAndCount(candidate.path) : { sizeBytes: stat.size, childCount: 0 };
  const type = candidate.forceType ?? classifyType(candidate.path, isDirectory, signals);
  const owner = detectOwner(candidate.path);

  return {
    id: stableId(candidate.path),
    name: path.basename(candidate.path),
    type,
    owner,
    scope: detectScope(candidate.path, candidate.projectPath),
    path: candidate.path,
    projectPath: candidate.projectPath,
    sizeBytes: sizeInfo.sizeBytes,
    modifiedAt: stat.mtime.toISOString(),
    signals: {
      ...signals,
      childCount: signals.childCount ?? sizeInfo.childCount
    }
  };
}

async function collectGlobalCandidates(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  for (const root of globalRoots) {
    if (!(await exists(root))) continue;
    candidates.push({ path: root, projectPath: null });

    const stack = [root];
    while (stack.length) {
      const current = stack.pop()!;
      const entries = await listDir(current);

      for (const entry of entries) {
        if (skipDirNames.has(entry.name)) continue;
        const entryPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          const signals = await buildSignals(entryPath, true);
          const lower = entry.name.toLowerCase();
          if (signals.hasSkillMd || ["agents", "subagents", "sessions", "history", "skills"].includes(lower)) {
            candidates.push({ path: entryPath, projectPath: null });
          }
          stack.push(entryPath);
          continue;
        }

        if (isInterestingFile(entryPath)) {
          candidates.push({ path: entryPath, projectPath: null });
        }
      }
    }
  }

  return candidates;
}

function isInterestingFile(filePath: string): boolean {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  return (
    base === ".mcp.json" ||
    ["claude.md", "agents.md", "memory.md", "user.md"].includes(lower) ||
    lower.includes("settings") ||
    lower.includes("config") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml")
  );
}

async function collectDesktopProjects(warnings: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const entries = shouldSkipDesktop ? [] : await listDirWithWarning(desktopDir, warnings);

  for (const entry of entries) {
    if (!entry.isDirectory() || skipDirNames.has(entry.name)) continue;
    const projectPath = path.join(desktopDir, entry.name);
    candidates.push(...(await collectProjectCandidates(projectPath)));
  }

  for (const projectPath of explicitProjectRoots) {
    const projectCandidates = await collectProjectCandidates(projectPath);
    if (projectCandidates.length === 0) {
      warnings.push(`Explicit project root has no recognized AI config: ${projectPath}`);
    }
    candidates.push(...projectCandidates);
  }

  return candidates;
}

async function collectProjectCandidates(projectPath: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const projectEntries = await listDir(projectPath);
  const hasAiConfig = projectEntries.some((projectEntry) => projectConfigNames.has(projectEntry.name));
  if (!hasAiConfig) return candidates;

  candidates.push({ path: projectPath, projectPath, forceType: "project" });

  for (const projectEntry of projectEntries) {
    if (!projectConfigNames.has(projectEntry.name)) continue;
    const assetPath = path.join(projectPath, projectEntry.name);
    candidates.push({ path: assetPath, projectPath });

    if (projectEntry.isDirectory()) {
      const childEntries = await listDir(assetPath);
      for (const child of childEntries) {
        if (skipDirNames.has(child.name)) continue;
        const childPath = path.join(assetPath, child.name);
        if (child.isDirectory()) {
          const signals = await buildSignals(childPath, true);
          if (signals.hasSkillMd || ["agents", "subagents", "sessions", "history", "skills"].includes(child.name.toLowerCase())) {
            candidates.push({ path: childPath, projectPath });
          }
        } else if (isInterestingFile(childPath)) {
          candidates.push({ path: childPath, projectPath });
        }
      }
    }
  }

  return candidates;
}

function summarize(assets: Asset[]): Atlas["summary"] {
  const summary: Atlas["summary"] = {
    assetCount: assets.length,
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

export async function scanAtlas(): Promise<Atlas> {
  const warnings: string[] = [];
  const allCandidates = [...(await collectGlobalCandidates()), ...(await collectDesktopProjects(warnings))];
  const unique = new Map<string, Candidate>();
  for (const candidate of allCandidates) unique.set(candidate.path, candidate);

  const assets = (await Promise.all([...unique.values()].map(makeAsset)))
    .filter((asset): asset is Asset => Boolean(asset))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    generatedAt: new Date().toISOString(),
    computer: {
      hostname: os.hostname(),
      home: os.homedir()
    },
    warnings,
    agents: assets.filter((asset) => asset.type === "agent"),
    projects: assets.filter((asset) => asset.type === "project"),
    assets,
    summary: summarize(assets)
  };
}
