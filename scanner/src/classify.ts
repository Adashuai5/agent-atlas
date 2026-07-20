import os from "node:os";
import path from "node:path";
import type { AssetIdentityReferences, PathIdentity, StateAssessment } from "./model.ts";

export type AssetType = "skill" | "memory" | "mcp" | "agent" | "config" | "session" | "project" | "plugin";
export type Owner = "codex" | "claude" | "agents" | "hermes" | "project" | "unknown";
export type Scope = "global" | "project" | "plugin" | "cache" | "unknown";

export interface Signals {
  hasSkillMd?: boolean;
  hasReadme?: boolean;
  hasMcpConfig?: boolean;
  isDirectory?: boolean;
  childCount?: number;
  sessionCount?: number;
  isTemplate?: boolean;
  pluginPackage?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  owner: Owner;
  scope: Scope;
  path: string;
  projectPath: string | null;
  sizeBytes: number;
  modifiedAt: string;
  signals: Signals;
  /** Physical storage owner. Runtime loading is represented by graph bindings. */
  placementOwner: Owner;
  identity: PathIdentity;
  states: {
    present: StateAssessment;
    valid: StateAssessment;
  };
  graph: AssetIdentityReferences;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * Storage ownership is determined only by a configured storage root. Runtime
 * consumers are represented by bindings and must never be inferred from an
 * arbitrary `codex`, `claude`, or `agents` path segment.
 */
export function detectOwner(filePath: string, homeDir = os.homedir(), projectPath: string | null = null): Owner {
  const roots: [Owner, string][] = [
    ["codex", path.join(homeDir, ".codex")],
    ["claude", path.join(homeDir, ".claude")],
    ["agents", path.join(homeDir, ".agents")],
    ["hermes", path.join(homeDir, ".hermes")]
  ];
  for (const [owner, root] of roots) {
    if (isInside(filePath, root)) return owner;
  }
  if (projectPath && isInside(filePath, projectPath)) return "project";
  return "unknown";
}

export function detectScope(filePath: string, projectPath: string | null): Scope {
  const lower = filePath.toLowerCase();
  if (lower.includes(`${path.sep}plugins${path.sep}`)) return "plugin";
  if (lower.includes(`${path.sep}cache${path.sep}`)) return "cache";
  if (projectPath) return "project";
  if (filePath.includes(`${path.sep}.codex`) || filePath.includes(`${path.sep}.claude`) || filePath.includes(`${path.sep}.agents`) || filePath.includes(`${path.sep}.hermes`)) {
    return "global";
  }
  return "unknown";
}

export function classifyType(filePath: string, isDirectory: boolean, signals: Signals): AssetType {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  const parent = path.basename(path.dirname(filePath)).toLowerCase();

  if (signals.hasSkillMd || lower === "skill.md") return "skill";
  if (lower === "plugin.json" && [".codex-plugin", ".claude-plugin"].includes(parent)) return "plugin";
  if (base === ".mcp.json" || signals.hasMcpConfig) return "mcp";
  if (["claude.md", "agents.md", "memory.md", "user.md"].includes(lower)) return "memory";
  if (isDirectory && ["agents", "subagents"].includes(lower)) return "agent";
  if (["agents", "subagents"].includes(parent) && (lower.endsWith(".md") || lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml"))) return "agent";
  if (isDirectory && ["sessions", "history"].includes(lower)) return "session";
  if (["sessions", "history"].includes(parent)) return "session";
  if (["settings.json", "settings.local.json", "config.json", "config.toml", "config.yaml", "config.yml"].includes(lower)) return "config";
  if ([".codex", ".claude", ".agents", ".hermes"].includes(base)) return "config";
  if (lower.endsWith(".toml") || lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) return "config";
  return "config";
}
