import fs from "node:fs/promises";
import path from "node:path";
import type { Atlas } from "./scan.ts";
import { buildSnapshot, renderContextMarkdown } from "./diagnose.ts";
import { renderDashboardHtml } from "./dashboard.ts";
import { atlasContextJsonPath, atlasContextMarkdownPath, atlasHtmlPath, atlasJsonPath, dataDir } from "./paths.ts";

type ContextLanguage = "zh" | "en";

export interface FullContextFiles {
  zh: string;
  en: string;
}

export function fullContextFileName(scopeIndex: number, language: ContextLanguage): string {
  const stem = scopeIndex === 0 ? "atlas-context-full" : `atlas-context-project-${scopeIndex}-full`;
  return language === "en" ? `${stem}.md` : `${stem}.zh.md`;
}

export async function writeAtlas(atlas: Atlas): Promise<void> {
  const snapshot = buildSnapshot(atlas, null);
  const projectPaths = [...new Set(atlas.projects.map((project) => project.projectPath ?? project.path))];
  const scopeSnapshots = [snapshot, ...projectPaths.map((projectPath) => buildSnapshot(atlas, projectPath))];
  const fullContextFiles = scopeSnapshots.map((_, scopeIndex) => ({
    zh: fullContextFileName(scopeIndex, "zh"),
    en: fullContextFileName(scopeIndex, "en")
  }));
  await fs.mkdir(dataDir, { recursive: true });
  const fullContextWrites = scopeSnapshots.flatMap((scope, scopeIndex) => (["zh", "en"] as ContextLanguage[]).map((language) =>
    fs.writeFile(
      path.join(dataDir, fullContextFiles[scopeIndex]![language]),
      renderContextMarkdown(scope, language, { full: true }),
      "utf8"
    )
  ));
  await Promise.all([
    fs.writeFile(atlasJsonPath, `${JSON.stringify(atlas, null, 2)}\n`, "utf8"),
    fs.writeFile(atlasContextJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"),
    fs.writeFile(atlasContextMarkdownPath, renderContextMarkdown(snapshot, "en", { fullContextPath: `data/${fullContextFiles[0]!.en}` }), "utf8"),
    fs.writeFile(atlasHtmlPath, renderHtml(snapshot, scopeSnapshots, fullContextFiles), "utf8"),
    ...fullContextWrites
  ]);
}

export function renderHtml(
  snapshot: ReturnType<typeof buildSnapshot>,
  scopeSnapshots: ReturnType<typeof buildSnapshot>[],
  fullContextFiles: FullContextFiles[] = scopeSnapshots.map((_, scopeIndex) => ({
    zh: fullContextFileName(scopeIndex, "zh"),
    en: fullContextFileName(scopeIndex, "en")
  }))
): string {
  return renderDashboardHtml(snapshot, scopeSnapshots, fullContextFiles);
}
