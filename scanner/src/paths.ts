import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const homeDir = os.homedir();
export const desktopDir = path.join(homeDir, "Desktop");
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const dataDir = path.join(projectRoot, "data");
export const atlasJsonPath = path.join(dataDir, "atlas.json");
export const atlasHtmlPath = path.join(dataDir, "atlas.html");
export const atlasContextJsonPath = path.join(dataDir, "atlas-context.json");
export const atlasContextMarkdownPath = path.join(dataDir, "atlas-context.md");
export const atlasContextFullMarkdownPath = path.join(dataDir, "atlas-context-full.md");

export const globalRoots = [
  path.join(homeDir, ".codex"),
  path.join(homeDir, ".claude"),
  path.join(homeDir, ".agents"),
  path.join(homeDir, ".hermes")
];

/** Explicit discovery roots. Storage ownership and runtime consumption are
 * deliberately separate: `.agents` is a store, while a symlink placed under a
 * runtime's skills directory creates the binding for that runtime. */
export const globalSkillRoots = [
  { path: path.join(homeDir, ".codex", "skills"), placementOwner: "codex", consumer: "codex", recursive: true },
  { path: path.join(homeDir, ".claude", "skills"), placementOwner: "claude", consumer: "claude", recursive: false },
  { path: path.join(homeDir, ".agents", "skills"), placementOwner: "agents", consumer: null, recursive: false },
  { path: path.join(homeDir, ".hermes", "skills"), placementOwner: "hermes", consumer: "hermes", recursive: true },
  { path: path.join(homeDir, ".hermes", "hermes-agent", "skills"), placementOwner: "hermes", consumer: null, recursive: true }
] as const;

export const globalAgentRoots = [
  { path: path.join(homeDir, ".codex", "agents"), placementOwner: "codex", consumer: "codex" },
  { path: path.join(homeDir, ".claude", "agents"), placementOwner: "claude", consumer: "claude" },
  { path: path.join(homeDir, ".agents", "agents"), placementOwner: "agents", consumer: null },
  { path: path.join(homeDir, ".hermes", "agents"), placementOwner: "hermes", consumer: "hermes" }
] as const;

export const rootConfigNames = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "MEMORY.md",
  "SOUL.md",
  "USER.md",
  ".mcp.json",
  "config.toml",
  "config.json",
  "config.yaml",
  "config.yml",
  "settings.json",
  "settings.local.json"
]);

export const explicitProjectRoots = (process.env.AGENT_ATLAS_PROJECT_ROOTS ?? "")
  .split(path.delimiter)
  .map((root) => root.trim())
  .filter(Boolean)
  .map((root) => path.resolve(root));

export const shouldSkipDesktop = process.env.AGENT_ATLAS_SKIP_DESKTOP === "1";

export const skipDirNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".venv",
  "__pycache__",
  "Library",
  "Downloads"
]);

export const projectConfigNames = new Set([
  ".codex",
  ".claude",
  ".agents",
  ".hermes",
  "AGENTS.md",
  "CLAUDE.md",
  "MEMORY.md",
  "USER.md",
  ".mcp.json"
]);

export const projectMarkerNames = new Set([
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json"
]);
