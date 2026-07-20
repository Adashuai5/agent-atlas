# Product Notes

Agent Atlas is an answer-first resource health diagnostic, not an asset manager.

The first screen should answer what is present and valid, which runtime can see
it, what is enabled or confirmed loaded, which conclusions are still unknown,
and what deserves attention next. It must not turn inventory volume or a path
name into a claim about actual runtime influence.

## Core principles

- Diagnose before visualizing.
- Separate origin, storage, visibility, enablement, and loading.
- Attach evidence and confidence to every non-trivial state claim.
- Treat unknown as a first-class result.
- Show the answer first, then progressive detail.
- Stay read-only and local by default.
- Preserve both human and AI-native outputs.
- Avoid maintenance features and unnecessary complexity.

## Product model

The health model follows one explicit chain:

```text
canonical source -> installation or alias/mirror -> binding -> runtime consumer
```

Owner means storage ownership only. A consumer binding separately records that
Codex, Claude, Hermes, or a project-scoped consumer can discover a resource;
Agents is a storage owner, not a runtime consumer.
`present` and `valid` describe the stored resource; evidence-backed tri-state
`enabled` and `loaded` describe a consumer relationship. Absence of evidence is
unknown, never an implied false or true.

Duplicate diagnoses use identity and runtime visibility:

- Same realpath or physical device/inode: alias, healthy.
- Same content bound to different runtimes: mirror, informational; this does
  not prove loading or use.
- Same content confirmed loaded more than once by one runtime: redundant,
  attention. Visibility without `loaded=true` remains informational/uncertain.
- Divergent content visible to one runtime: conflict, warning.

Same names alone never establish conflict. Templates and examples may remain in
the complete inventory but do not become active global configuration merely
because they are named `config.*` or `claude.md`.

Plugins retain package-level meaning instead of being folded into one noise
bucket. Bundled, installed, enabled, and loaded are independent states, each
with its own evidence. Catalog, marketplace source, cache, and staging copies
remain distinguishable. User-installed Hermes packages and explicit plugin
allow/deny configuration are scanned, while cache presence alone never becomes
an installation or loading claim.

## Human and AI outputs

One semantic model backs two native paths:

- Human: bilingual Chinese/English conclusions, health overview, high-signal
  diagnoses, evidence, and resource drill-down.
- AI: compact Markdown, complete Markdown, and structured JSON with scope,
  tri-state status, confidence, evidence, and explicit interpretation rules.

The dashboard defaults to the global machine. Project analysis remains a
cascading choice: select Project, then select a discovered code or AI-configured
project. A project without direct AI configuration stays visible and is shown
as inheriting global resources; inheritance is not described as confirmed
loading without runtime evidence.

Heatmap area represents `resourceSurfaceWeight`, a visual weight for the size
of the available resource surface. Color represents diagnosed
health. Area must not be labeled influence, usage, effectiveness, or loading.
Exact counts and evidence belong in tooltips and detail views.

Compact Markdown may cap long lists, but it must report the exact omitted
count. Scope/language-specific full Markdown files and `atlas.json` provide
complete AI-readable and structured paths without that cap. The dashboard's
Full Context link must follow both the selected project scope and language.

## Safety boundary

Atlas observes user resources and writes only its own report files. It never
deletes, archives, moves, edits, installs, enables, disables, or deduplicates
resources. A warning or redundant diagnosis is advice for inspection, not
authorization to mutate the environment.

Install, update, removal, sync, marketplace management, presets, migration, and
automatic cleanup remain outside the product boundary.
