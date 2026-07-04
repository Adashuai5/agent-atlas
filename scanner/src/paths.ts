import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const homeDir = os.homedir();
export const desktopDir = path.join(homeDir, "Desktop");
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const dataDir = path.join(projectRoot, "data");
export const atlasJsonPath = path.join(dataDir, "atlas.json");
export const atlasHtmlPath = path.join(dataDir, "atlas.html");

export const globalRoots = [
  path.join(homeDir, ".codex"),
  path.join(homeDir, ".claude"),
  path.join(homeDir, ".agents"),
  path.join(homeDir, ".hermes")
];

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
