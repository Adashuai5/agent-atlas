import path from "node:path";

export type AssetType = "skill" | "memory" | "mcp" | "agent" | "config" | "session" | "project";
export type Owner = "codex" | "claude" | "agents" | "hermes" | "unknown";
export type Scope = "global" | "project" | "plugin" | "cache" | "unknown";

export interface Signals {
  hasSkillMd?: boolean;
  hasReadme?: boolean;
  hasMcpConfig?: boolean;
  isDirectory?: boolean;
  childCount?: number;
  sessionCount?: number;
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
}

export function detectOwner(filePath: string): Owner {
  const parts = filePath.split(path.sep);
  const base = path.basename(filePath).toLowerCase();
  if (base === "claude.md") return "claude";
  if (base === "agents.md") return "agents";
  if (parts.includes(".codex") || parts.includes("codex")) return "codex";
  if (parts.includes(".claude") || parts.includes("claude")) return "claude";
  if (parts.includes(".agents") || parts.includes("agents") || parts.includes("subagents")) return "agents";
  if (parts.includes(".hermes") || parts.includes("hermes")) return "hermes";
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
