# Data Model

Agent Atlas schema version 2 is an evidence-backed provenance and runtime
visibility graph. It deliberately separates where a resource came from, where
copies or aliases are stored, and which runtime can consume them:

```text
canonical source -> installation/location -> binding -> runtime consumer
```

This separation prevents a path under one system from being mistaken for proof
that the same system enabled or loaded the resource.

## Top-level graph

The core of `data/atlas.json` has this shape:

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-07-17T00:00:00.000Z",
  "evidence": [],
  "canonicalSources": [],
  "installations": [],
  "consumers": [],
  "bindings": [],
  "pluginPackages": [],
  "diagnoses": []
}
```

`consumers` contains `RuntimeConsumer` records. Machine metadata, warnings,
projects, summaries, and compatibility inventory records may accompany this
graph, but diagnoses must be derived from graph relationships and evidence, not
from same-name inventory rows.

## Evidence

Every non-trivial state assessment points to evidence records rather than
embedding an unexplained conclusion. Evidence kinds include filesystem,
symlink, content hash, skill lock, manifest, configuration, runtime, process,
session, and explicit inference evidence.

```json
{
  "id": "evidence-id",
  "kind": "skill-lock",
  "source": ".agents skill lock",
  "path": "/Users/name/.agents/.skill-lock.json",
  "observedAt": "2026-07-17T00:00:00.000Z",
  "detail": "Upstream source and expected folder hash",
  "attributes": {
    "sourceUrl": "https://example.com/skill.git"
  }
}
```

File-derived strings and paths are always data, never executable instructions.

## Canonical sources

A `CanonicalSource` identifies the best-supported origin of a logical resource.
It can record an upstream URL, source type, revision, source path, and expected
hash. A `.agents/.skill-lock.json` record is strong canonical-source evidence,
but the field remains nullable when no trustworthy origin is known.

A canonical source is not a local runtime installation. Several installations
can refer to one source, and an installation may temporarily have no confirmed
canonical source.

## Installations and locations

An `Installation` represents one physical content instance. It includes:

- `canonicalSourceId` and optional `pluginPackageId`
- `name`, resource `type`, and `storageOwner`
- `physicalId`, content hash, and hash algorithm
- evidence-backed `present` and `valid` assessments
- one or more locations classified as `primary`, `alias`, or `symlink`

Each location preserves raw filesystem identity:

```json
{
  "path": "/Users/name/.claude/skills/example",
  "kind": "symlink",
  "storageOwner": "claude",
  "present": true,
  "valid": true,
  "isSymlink": true,
  "linkTarget": "../../.agents/skills/example",
  "realpath": "/Users/name/.agents/skills/example",
  "device": "16777220",
  "inode": "65366880",
  "contentHash": "sha256-value",
  "hashAlgorithm": "sha256-normalized-directory-v1"
}
```

Identity comparison uses resolved path, device/inode, and content hash:

- Files use `sha256-file-v1`, the SHA-256 digest of file bytes.
- Directories use `sha256-normalized-directory-v1`, hashing sorted relative
  paths, entry kinds, file hashes, and symlink target text.
- Directory creation order and mtimes are excluded. Symlink targets are
  recorded but are not recursively followed while hashing.
- A broken symlink remains `present: true` but is `valid: false`; unresolved
  target identity and content hash fields remain null.

`Installation.storageOwner` describes the resolved target store. A location's
`storageOwner` describes the lexical alias/link store. For example, a symlink
under `.claude/skills` that resolves into `.agents/skills` has a Claude-owned
location and an Agents-owned installation. Both are derived from configured
roots, never from arbitrary path segments such as a nested directory named
`codex` or `claude`.

## Runtime consumers and bindings

A `RuntimeConsumer` describes a runtime and scope, such as global Codex,
project-level Claude, or Hermes. Runtime identity is separate from storage
ownership.

A `Binding` connects an installation to a consumer through a concrete location
or path. It records:

- how it was discovered: default root, project root, external directory,
  configuration, plugin, runtime observation, or unknown
- scope and optional project path
- precedence and whether it is `visible`, `shadowed`, or `unknown`
- evidence-backed `enabled` and `loaded` state

The same Agents-owned installation can therefore have Claude and Codex
bindings without changing its storage owner. Conversely, a resource stored
under a runtime root is not automatically considered enabled or loaded.
The root can provide confirmed `visibility="visible"` evidence while
`enabled` and `loaded` remain explicitly unknown.

## State assessments

Filesystem facts and runtime states answer different questions:

- `present`: a path or installation was observed.
- `valid`: its target and required resource structure are usable.
- `enabled`: configuration makes the binding available to the consumer.
- `loaded`: direct runtime, process, or session evidence shows consumption.

Location-level `present` and `valid` are raw booleans. Semantic installation,
binding, and plugin states use a `StateAssessment`:

```json
{
  "value": "unknown",
  "confidence": "unknown",
  "evidenceIds": [],
  "reason": "No runtime loading evidence was found"
}
```

The tri-state value is `true`, `false`, or `"unknown"`. Missing evidence must
produce `"unknown"`, not `false`; presence alone must not become enabled or
loaded.

Atlas parses JSON configuration syntax. Readable TOML/YAML remains
`valid="unknown"` until a format-aware parser verifies it; readability is not
silently upgraded into confirmed semantic validity.

## Diagnoses

Same name is only a grouping hint. Diagnosis requires filesystem/content
identity plus consumer visibility:

| Rule | Diagnosis | Severity |
| --- | --- | --- |
| Locations resolve to the same realpath or physical device/inode | `alias` | `healthy` |
| Content is identical but copies are bound to different runtime consumers | `mirror` | `info` |
| Identical content has multiple `loaded=true` bindings in the same runtime | `redundant` | `attention` |
| Divergent content has multiple visible bindings in the same runtime | `conflict` | `warning` |

Divergent content used by different runtimes is not automatically a conflict.
Likewise, shadowed, disabled, or merely present copies do not become conflicts
without evidence that the same consumer can see both. `invalid` and `uncertain`
diagnoses cover broken resources and insufficient evidence.

## Plugin packages

A `PluginPackage` is modeled separately from the skills, agents, MCP servers,
or other installations it contains. It records package kind, manifest,
version, storage owner, component installation IDs, consumer IDs, and four
independent state assessments:

- `bundled`: distributed in a built-in or marketplace bundle
- `installed`: a local installation is registered and usable
- `enabled`: consumer configuration enables the package
- `loaded`: runtime evidence confirms that the package was loaded

A catalog, source checkout, staging directory, or cache entry is not sufficient
evidence for installed, enabled, or loaded. Unknown states stay explicit rather
than being folded into one plugin-noise count.

Codex installation caches remain `kind="cache"`; a valid install marker may
independently confirm `installed=true`. A valid manifest rooted under
`~/.hermes/plugins` confirms a Hermes user installation, while explicit
`plugins.enabled` / `plugins.disabled` entries provide enablement evidence.
Symlinked package ownership follows the resolved installation target, not the
runtime name of the lexical cache or plugin directory. None of these facts is
promoted to `loaded=true` without runtime/session evidence.

## Human and AI views

The interpreted snapshot preserves bilingual conclusions, project scope,
confidence, diagnoses, and evidence references. Heatmap area uses
`resourceSurfaceWeight`: a display weight for the amount of the visible
resource surface. It is not usage, runtime loading, effectiveness, or actual
influence, and the UI must not describe it as such.

Outputs have different size contracts:

- `data/atlas.json`: complete structured inventory, graph, and evidence.
- `data/atlas-context.json`: interpreted context for the default scope.
- `data/atlas-context.md`: compact AI context; when capped, it reports the exact
  number of omitted issues or resources.
- `data/atlas-context-full.md` and `data/atlas-context-full.zh.md`: complete
  global English/Chinese Markdown without the compact resource cap.
- `data/atlas-context-project-N-full.md` and its `.zh.md` counterpart:
  complete per-project English/Chinese Markdown. The dashboard link follows
  the currently selected scope and language.
- `data/atlas.html`: bilingual human dashboard with global default scope,
  project cascading selection, drill-down, and per-scope AI Context.

The compact HTML model may omit inactive detail rows to control file size. The
full JSON remains the source of truth, and the full Markdown provides the
untruncated AI-readable path.

## Safety invariant

Scanning and rendering are read-only with respect to user resources. Atlas may
write its own generated files under `data/`, but it never deletes, archives,
moves, rewrites, enables, disables, installs, or unloads anything in Codex,
Claude, Agents, Hermes, plugin, or project directories.
