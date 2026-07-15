# Product Notes

Agent Atlas is answer-first, not manager-first.

The first screen should answer: what actually affects the current project,
which systems provide it, what is uncertain or conflicting, and what deserves
attention next.

Core principles:

- See first, manage later.
- Diagnose, then visualize.
- Answer first.
- Read-only by default.
- Progressive detail.
- No maintenance tax.
- Complexity is a risk.

The product has two native outputs backed by one semantic snapshot:

- Human: conclusion, system health heatmap, high-signal issues, and clear
  resource drill-down.
- AI: compact Markdown and structured JSON with scope, confidence, evidence,
  and explicit interpretation rules.

Heatmap grammar is fixed: area represents influence, color represents health,
labels stay sparse, and exact counts move to tooltips and detail views.

The default scope is the global machine. Project analysis is a cascading choice:
select Project first, then a discovered code or AI-configured project. Projects
without direct AI configuration remain visible and are assessed as inheriting
global configuration only.

First version deliberately avoids install, update, delete, sync, marketplace,
preset, or migration features.
