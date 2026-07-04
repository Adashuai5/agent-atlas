# Agent Atlas

Local, read-only map for AI agent assets on this machine.

Agent Atlas scans common local AI configuration locations, writes a structured
`data/atlas.json`, and generates a static `data/atlas.html` summary that can be
opened directly in a browser.

## Scope

MVP does:

- read-only local scanning
- global and Desktop project discovery
- skill, memory, MCP, agent, config, session, and project classification
- stable JSON output
- static HTML overview

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
- `data/atlas.html`

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
