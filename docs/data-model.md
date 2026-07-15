# Data Model

`data/atlas.json`:

```json
{
  "generatedAt": "2026-07-04T00:00:00.000Z",
  "computer": {
    "hostname": "host",
    "home": "/Users/name"
  },
  "warnings": [],
  "agents": [],
  "projects": [],
  "assets": [],
  "summary": {
    "assetCount": 0,
    "byType": {},
    "byOwner": {},
    "byScope": {}
  }
}
```

Asset:

```json
{
  "id": "stable-id",
  "name": "SKILL.md",
  "type": "skill",
  "owner": "codex",
  "scope": "global",
  "path": "/Users/name/.codex/skills/foo",
  "projectPath": null,
  "sizeBytes": 1234,
  "modifiedAt": "2026-07-04T00:00:00.000Z",
  "signals": {
    "hasSkillMd": true,
    "hasReadme": false
  }
}
```

Types: `skill`, `memory`, `mcp`, `agent`, `config`, `session`, `project`.

Owners: `codex`, `claude`, `agents`, `hermes`, `unknown`.

Scopes: `global`, `project`, `plugin`, `cache`, `unknown`.

`data/atlas-context.json` is the interpreted snapshot consumed by the HTML and
AI Markdown renderers. It adds:

- `conclusion`: the answer shown first
- `systems`: per-system resource mix, influence, and health
- `resources`: effective state, confidence, and the reason for that judgment
- `issues`: severity, evidence asset IDs, and recommended next action
- `stats`: effective, direct-project, inherited-global, discovered, and
  folded-noise counts

Health values: `healthy`, `attention`, `warning`, `inactive`.

Confidence values: `confirmed`, `inferred`, `unknown`.

The HTML embeds a compact view model only: effective resources plus evidence
for actionable issues. Full inactive/cache/source assets remain in JSON and are
not duplicated for every project scope.
