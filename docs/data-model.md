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
