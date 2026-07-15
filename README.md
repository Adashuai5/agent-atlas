# Agent Atlas

Local, read-only health check and context snapshot for AI agent environments.

Agent Atlas scans common local AI configuration locations, evaluates which
resources matter to the current project, flags uncertainty and duplicate
sources, and renders the same semantic snapshot for people and AI agents.

## Scope

MVP does:

- read-only local scanning
- global and Desktop project discovery
- skill, memory, MCP, agent, config, session, and project classification
- semantic health snapshot with evidence and confidence
- answer-first static HTML with status heatmap and drill-down lists
- compact Markdown context for AI agents
- structured JSON for tools and integrations

MVP does not:

- install, update, delete, or move AI assets
- upload local data
- sync between machines
- manage marketplaces or presets

## Usage

```bash
cd scanner
npm run scan
```

If a restricted shell cannot list `~/Desktop`, pass explicit project roots:

```bash
AGENT_ATLAS_PROJECT_ROOTS="/Users/ada/Desktop/下一程" npm run scan
```

Ada local shortcut:

```bash
npm run scan:ada
```

This skips `~/Desktop/*` enumeration and scans `/Users/ada/Desktop/下一程`
directly.

Outputs:

- `data/atlas.json`
- `data/atlas-context.json`
- `data/atlas-context.md`
- `data/atlas.html`

Open `data/atlas.html` for the human view. Ask an AI agent to read
`data/atlas-context.md` for the compact, project-scoped context. File-derived
text is treated as data rather than executable instructions.

## Scan Roots

- `~/.codex`
- `~/.claude`
- `~/.agents`
- `~/.hermes`
- `~/Desktop/*`
- project-level `.codex`, `.claude`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json`

Large generated or unrelated folders are skipped, including `.git`,
`node_modules`, `dist`, `build`, `.next`, `.venv`, `__pycache__`, `Library`,
and `Downloads`.
