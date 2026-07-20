import fs from "node:fs/promises";
import path from "node:path";

export interface SkillLockRecord {
  name: string;
  source: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  skillPath: string | null;
  skillFolderHash: string | null;
  installedAt: string | null;
  updatedAt: string | null;
}

export interface SkillLockResult {
  path: string;
  version: number | null;
  records: Map<string, SkillLockRecord>;
  warning: string | null;
}

export interface HermesSkillConfigResult {
  path: string;
  paths: string[];
  disabled: string[];
  warning: string | null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function readSkillLock(homeDir: string): Promise<SkillLockResult> {
  const lockPath = path.join(homeDir, ".agents", ".skill-lock.json");
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      version?: unknown;
      skills?: Record<string, Record<string, unknown>>;
    };
    const records = new Map<string, SkillLockRecord>();
    for (const [name, value] of Object.entries(parsed.skills ?? {})) {
      if (!value || typeof value !== "object") continue;
      records.set(name.toLowerCase(), {
        name,
        source: optionalString(value.source),
        sourceType: optionalString(value.sourceType),
        sourceUrl: optionalString(value.sourceUrl),
        skillPath: optionalString(value.skillPath),
        skillFolderHash: optionalString(value.skillFolderHash),
        installedAt: optionalString(value.installedAt),
        updatedAt: optionalString(value.updatedAt)
      });
    }
    return {
      path: lockPath,
      version: typeof parsed.version === "number" ? parsed.version : null,
      records,
      warning: null
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    if (code === "ENOENT") return { path: lockPath, version: null, records: new Map(), warning: null };
    const detail = error instanceof Error ? error.message : String(error);
    return { path: lockPath, version: null, records: new Map(), warning: `Cannot parse ${lockPath}: ${detail}` };
  }
}

function stripYamlComment(line: string): string {
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === "\"") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (character === quote && line[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function yamlScalar(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "~") return null;
  if (trimmed.startsWith("\"")) {
    if (!trimmed.endsWith("\"") || trimmed.length < 2) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) return null;
    const parsed = trimmed.slice(1, -1).replace(/''/g, "'").trim();
    return parsed || null;
  }
  if (/^[\[\]{}]/.test(trimmed) || /[\[\]{}]$/.test(trimmed)) return null;
  return trimmed;
}

function splitInlineList(contents: string): string[] | null {
  const values: string[] = [];
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index <= contents.length; index += 1) {
    const character = contents[index];
    if (quote === "\"") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (character === quote && contents[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "," || index === contents.length) {
      const raw = contents.slice(start, index).trim();
      if (raw) {
        const parsed = yamlScalar(raw);
        if (parsed === null) return null;
        values.push(parsed);
      }
      start = index + 1;
    }
  }
  return quote ? null : values;
}

function inlineOrScalar(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed === "[]") return [];
  if (trimmed.startsWith("[")) {
    if (!trimmed.endsWith("]")) return null;
    return splitInlineList(trimmed.slice(1, -1));
  }
  const scalar = yamlScalar(trimmed);
  return scalar === null ? null : [scalar];
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, braced: string | undefined, bare: string | undefined) => {
    const name = braced ?? bare ?? "";
    return process.env[name] ?? match;
  });
}

function resolveHermesExternalPath(entry: string, homeDir: string): string {
  const expandedEnvironment = expandEnvironmentVariables(entry);
  const expandedHome = expandedEnvironment === "~" || expandedEnvironment.startsWith(`~${path.sep}`)
    ? path.join(homeDir, expandedEnvironment.slice(2))
    : expandedEnvironment;
  return path.resolve(path.isAbsolute(expandedHome) ? expandedHome : path.join(homeDir, ".hermes", expandedHome));
}

/**
 * Read the focused Hermes `skills` configuration without interpreting the rest
 * of config.yaml. Both inline and block lists are supported. Malformed list
 * fragments fail open: no skill is disabled without a parsed string value, and
 * the caller receives a warning instead of a partial affirmative result.
 */
export async function readHermesExternalDirs(homeDir: string): Promise<HermesSkillConfigResult> {
  const configPath = path.join(homeDir, ".hermes", "config.yaml");
  try {
    const lines = (await fs.readFile(configPath, "utf8")).split(/\r?\n/);
    const paths: string[] = [];
    const disabled: string[] = [];
    const parseWarnings: string[] = [];
    let inSkills = false;
    let skillsIndent = -1;
    let inExternal = false;
    let externalIndent = -1;
    let inDisabled = false;
    let disabledIndent = -1;

    for (const line of lines) {
      const stripped = stripYamlComment(line);
      if (!stripped.trim()) continue;
      const indent = stripped.length - stripped.trimStart().length;
      const value = stripped.trim();
      if (value === "skills:") {
        inSkills = true;
        skillsIndent = indent;
        inExternal = false;
        inDisabled = false;
        continue;
      }
      if (inSkills && indent <= skillsIndent) {
        inSkills = false;
        inExternal = false;
        inDisabled = false;
      }
      if (!inSkills) continue;
      if (value.startsWith("external_dirs:")) {
        const inline = value.slice("external_dirs:".length).trim();
        inExternal = !inline;
        inDisabled = false;
        externalIndent = indent;
        if (inline) {
          const parsed = inlineOrScalar(inline);
          if (parsed === null) parseWarnings.push("Malformed skills.external_dirs value");
          else paths.push(...parsed);
        }
        continue;
      }
      if (value.startsWith("disabled:")) {
        const inline = value.slice("disabled:".length).trim();
        inDisabled = !inline;
        inExternal = false;
        disabledIndent = indent;
        if (inline) {
          const parsed = inlineOrScalar(inline);
          if (parsed === null) parseWarnings.push("Malformed skills.disabled value");
          else disabled.push(...parsed);
        }
        continue;
      }
      if (inExternal && indent >= externalIndent && (value === "-" || value.startsWith("- "))) {
        const parsed = yamlScalar(value.slice(1));
        if (parsed === null) parseWarnings.push("Malformed skills.external_dirs list item");
        else paths.push(parsed);
      } else if (inExternal && indent <= externalIndent) {
        inExternal = false;
      }
      if (inDisabled && indent >= disabledIndent && (value === "-" || value.startsWith("- "))) {
        const parsed = yamlScalar(value.slice(1));
        if (parsed === null) parseWarnings.push("Malformed skills.disabled list item");
        else disabled.push(parsed);
      } else if (inDisabled && indent <= disabledIndent) {
        inDisabled = false;
      }
    }

    const localSkillsPath = path.resolve(homeDir, ".hermes", "skills");
    const resolvedPaths = [...new Set(paths
      .filter(Boolean)
      .map((entry) => resolveHermesExternalPath(entry, homeDir)))]
      .filter((entry) => entry !== localSkillsPath);
    return {
      path: configPath,
      paths: resolvedPaths,
      disabled: [...new Set(disabled.filter(Boolean))],
      warning: parseWarnings.length ? `${configPath}: ${[...new Set(parseWarnings)].join("; ")}` : null
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    if (code === "ENOENT") return { path: configPath, paths: [], disabled: [], warning: null };
    return { path: configPath, paths: [], disabled: [], warning: `Cannot read ${configPath}` };
  }
}
