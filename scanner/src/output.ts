import fs from "node:fs/promises";
import type { Asset } from "./classify.ts";
import type { Atlas } from "./scan.ts";
import { atlasHtmlPath, atlasJsonPath, dataDir } from "./paths.ts";

interface TileNode {
  id: string;
  label: string;
  value: number;
  colorKey: string;
  meta: string;
  assets: Asset[];
}

interface Rect extends TileNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function writeAtlas(atlas: Atlas): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(atlasJsonPath, `${JSON.stringify(atlas, null, 2)}\n`, "utf8");
  await fs.writeFile(atlasHtmlPath, renderHtml(atlas), "utf8");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function topEntry(counts: Record<string, number>): [string, number] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["unknown", 0];
}

function clusterNodes(assets: Asset[]): TileNode[] {
  const groups = new Map<string, Asset[]>();
  for (const asset of assets) {
    const key = `${asset.owner}|${asset.scope}|${asset.type}`;
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, items]) => {
    const [owner, scope, type] = key.split("|");
    return {
      id: key,
      label: `${owner} / ${type}`,
      value: items.length,
      colorKey: owner,
      meta: scope,
      assets: items
    };
  }).sort((a, b) => b.value - a.value);
}

function treemap(nodes: TileNode[], x: number, y: number, w: number, h: number): Rect[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x, y, w, h }];
  const total = nodes.reduce((sum, node) => sum + node.value, 0);
  const half = total / 2;
  let running = nodes[0].value;
  let splitCount = 1;
  while (splitCount < nodes.length - 1 && running + nodes[splitCount].value <= half) {
    running += nodes[splitCount].value;
    splitCount += 1;
  }
  const a = nodes.slice(0, splitCount);
  const b = nodes.slice(splitCount);
  const aTotal = a.reduce((sum, node) => sum + node.value, 0);
  const ratio = total > 0 ? aTotal / total : 0.5;
  if (w >= h) {
    const aw = w * ratio;
    return [...treemap(a, x, y, aw, h), ...treemap(b, x + aw, y, w - aw, h)];
  }
  const ah = h * ratio;
  return [...treemap(a, x, y, w, ah), ...treemap(b, x, y + ah, w, h - ah)];
}

function color(key: string): string {
  const colors: Record<string, string> = {
    codex: "#109182",
    hermes: "#7048e8",
    claude: "#c16620",
    agents: "#2f6eea",
    unknown: "#65758b",
    global: "#109182",
    plugin: "#7048e8",
    cache: "#7048e8",
    project: "#c16620",
    skill: "#16a34a",
    agent: "#2f6eea",
    config: "#64748b",
    memory: "#be123c",
    mcp: "#c16620",
    session: "#65758b"
  };
  return colors[key] ?? colors.unknown;
}

function pct(value: number, total: number): string {
  return total ? `${Math.round((value / total) * 100)}%` : "0%";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function renderStaticTile(rect: Rect, total: number): string {
  const compact = rect.w * rect.h < 220 ? " compact" : "";
  const tiny = rect.w * rect.h < 80 ? " tiny" : "";
  return `<button class="tile${compact}${tiny}" style="left:${rect.x}%;top:${rect.y}%;width:${rect.w}%;height:${rect.h}%;--c:${color(rect.colorKey)}">
    <span class="tile-label">${escapeHtml(rect.label)}</span>
    <span class="tile-meta">${escapeHtml(rect.meta)}</span>
    <strong>${rect.value}</strong>
    <em>${pct(rect.value, total)}</em>
  </button>`;
}

function renderHtml(atlas: Atlas): string {
  const [topOwner, topOwnerCount] = topEntry(atlas.summary.byOwner);
  const [topType, topTypeCount] = topEntry(atlas.summary.byType);
  const initialRects = treemap(clusterNodes(atlas.assets), 0, 0, 100, 100);
  const staticTiles = initialRects.map((rect) => renderStaticTile(rect, atlas.summary.assetCount)).join("");
  const data = JSON.stringify(atlas.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    owner: asset.owner,
    scope: asset.scope,
    path: asset.path,
    projectPath: asset.projectPath,
    sizeBytes: asset.sizeBytes,
    modifiedAt: asset.modifiedAt
  }))).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Atlas</title>
  <style>
    :root { --bg:#101826; --panel:#f8fafc; --ink:#152033; --muted:#617083; --line:rgba(255,255,255,.18); }
    * { box-sizing: border-box; }
    body { margin:0; height:100vh; overflow:hidden; background:var(--bg); color:var(--ink); font:14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button, input, select { font:inherit; }
    button { cursor:pointer; }
    .topbar { height:96px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:14px; align-items:center; padding:12px 16px; background:var(--panel); border-bottom:1px solid rgba(15,23,42,.14); }
    h1 { margin:0; font-size:21px; line-height:1.12; letter-spacing:0; }
    .answer { margin:6px 0 0; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .controls { display:grid; grid-template-columns:210px repeat(6,auto); gap:8px; align-items:center; }
    .controls input, .controls button { min-height:34px; border:1px solid rgba(15,23,42,.18); border-radius:8px; background:#fff; color:var(--ink); padding:0 10px; }
    .controls button.active { background:#152033; color:#fff; border-color:#152033; }
    .heatmap { position:relative; height:calc(100vh - 96px); padding:8px; background:#101826; }
    .crumbs { position:absolute; z-index:8; left:18px; top:18px; display:flex; gap:6px; flex-wrap:wrap; max-width:calc(100vw - 420px); }
    .crumbs button { min-height:30px; border:1px solid rgba(255,255,255,.38); border-radius:999px; background:rgba(248,250,252,.9); color:#152033; padding:0 10px; box-shadow:0 8px 28px rgba(0,0,0,.14); }
    .board { position:relative; width:100%; height:100%; overflow:hidden; border-radius:8px; background:#0f172a; box-shadow:inset 0 0 0 1px rgba(255,255,255,.12); }
    .tile { position:absolute; overflow:hidden; border:2px solid #101826; border-radius:7px; color:white; text-align:left; padding:10px; background:radial-gradient(circle at 74% 18%,rgba(255,255,255,.18),transparent 32%),linear-gradient(135deg,var(--c),#172033); box-shadow:inset 0 0 0 1px rgba(255,255,255,.14); transition:filter .12s ease,transform .12s ease,border-color .12s ease; }
    .tile:hover { z-index:5; filter:brightness(1.08); transform:translateY(-1px); border-color:rgba(255,255,255,.82); }
    .tile-label { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:850; font-size:clamp(11px,1.55vw,24px); text-shadow:0 1px 2px rgba(0,0,0,.28); }
    .tile-meta { display:block; margin-top:4px; color:rgba(255,255,255,.78); font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .tile strong { position:absolute; left:10px; bottom:7px; font-size:clamp(18px,3.2vw,58px); line-height:.9; letter-spacing:0; text-shadow:0 1px 2px rgba(0,0,0,.24); }
    .tile em { position:absolute; right:10px; bottom:9px; font-style:normal; color:rgba(255,255,255,.82); font-size:12px; }
    .tile.compact { padding:7px; }
    .tile.compact .tile-meta { display:none; }
    .tile.compact strong { font-size:clamp(14px,2vw,28px); left:7px; bottom:6px; }
    .tile.tiny { padding:0; }
    .tile.tiny .tile-label, .tile.tiny .tile-meta, .tile.tiny strong, .tile.tiny em { display:none; }
    .detail { position:absolute; right:18px; bottom:18px; z-index:10; width:min(480px,calc(100vw - 36px)); max-height:min(520px,calc(100vh - 136px)); overflow:auto; display:none; border:1px solid rgba(15,23,42,.18); border-radius:8px; background:rgba(248,250,252,.97); box-shadow:0 24px 70px rgba(0,0,0,.36); padding:16px; }
    .detail.show { display:block; }
    .detail h2 { margin:0 0 4px; font-size:20px; letter-spacing:0; }
    .detail p { margin:0 0 12px; color:var(--muted); }
    .detail ol { margin:0; padding-left:20px; }
    .detail li { margin:7px 0; overflow-wrap:anywhere; }
    .detail .close { position:absolute; right:10px; top:10px; width:28px; height:28px; border:1px solid rgba(15,23,42,.18); border-radius:8px; background:#fff; }
    .detail .drill { min-height:34px; margin:0 0 12px; border:1px solid rgba(15,23,42,.18); border-radius:8px; background:#152033; color:#fff; padding:0 10px; }
    .en [data-zh] { display:none; }
    body:not(.en) [data-en] { display:none; }
    @media (max-width:900px) { .topbar { height:150px; grid-template-columns:1fr; align-items:start; } .controls { grid-template-columns:1fr 1fr 1fr; } .answer { white-space:normal; } .heatmap { height:calc(100vh - 150px); padding:5px; } .crumbs { max-width:calc(100vw - 36px); } }
  </style>
</head>
<body>
  <header class="topbar">
    <div>
      <h1><span data-zh>本机 AI 资产热力图</span><span data-en>Local AI Asset Heatmap</span></h1>
      <p id="answer" class="answer">
        <span data-zh>共 ${atlas.summary.assetCount} 个资产；最大系统 ${escapeHtml(topOwner)}（${topOwnerCount}），最大类型 ${escapeHtml(topType)}（${topTypeCount}）。点击区块看详情或下钻。</span>
        <span data-en>${atlas.summary.assetCount} assets. Largest owner: ${escapeHtml(topOwner)} (${topOwnerCount}); largest type: ${escapeHtml(topType)} (${topTypeCount}). Click tiles for detail or drilldown.</span>
      </p>
    </div>
    <div class="controls">
      <input id="search" type="search" placeholder="搜索名称或路径">
      <button data-mode="cluster" class="active">总览</button>
      <button data-mode="owner">系统</button>
      <button data-mode="scope">作用域</button>
      <button data-mode="type">类型</button>
      <button data-mode="project">项目</button>
      <button id="lang"><span data-zh>English</span><span data-en>中文</span></button>
    </div>
  </header>
  <main class="heatmap">
    <nav id="crumbs" class="crumbs"></nav>
    <section id="board" class="board">${staticTiles}</section>
    <aside id="detail" class="detail"></aside>
  </main>
  <script id="asset-data" type="application/json">${data}</script>
  <script>
    const allAssets = JSON.parse(document.getElementById("asset-data").textContent);
    const board = document.getElementById("board");
    const detail = document.getElementById("detail");
    const search = document.getElementById("search");
    const crumbs = document.getElementById("crumbs");
    const modeButtons = Array.prototype.slice.call(document.querySelectorAll("[data-mode]"));
    let mode = "cluster";
    let stack = [{ label: "全部", assets: allAssets, mode: "cluster" }];

    const colors = { codex:"#109182", hermes:"#7048e8", claude:"#c16620", agents:"#2f6eea", unknown:"#65758b", global:"#109182", plugin:"#7048e8", cache:"#7048e8", project:"#c16620", skill:"#16a34a", agent:"#2f6eea", config:"#64748b", memory:"#be123c", mcp:"#c16620", session:"#65758b" };

    function group(items, keyFn) {
      const out = new Map();
      items.forEach((asset) => {
        const key = keyFn(asset) || "unknown";
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(asset);
      });
      return out;
    }

    function nodesFor(items, currentMode) {
      if (currentMode === "assets") {
        return items.map((asset) => ({ id: asset.id, label: asset.name, value: Math.max(1, Math.round(asset.sizeBytes / 1024)), valueLabel: bytes(asset.sizeBytes), colorKey: asset.owner, meta: asset.type + " · " + asset.scope, assets: [asset], leaf: true })).sort((a,b) => b.value - a.value);
      }
      const keyFn = {
        cluster: (a) => a.owner + "|" + a.scope + "|" + a.type,
        owner: (a) => a.owner,
        scope: (a) => a.scope,
        type: (a) => a.type,
        project: (a) => a.projectPath || "global"
      }[currentMode];
      return Array.from(group(items, keyFn).entries()).map(([key, assets]) => {
        const parts = key.split("|");
        return {
          id: key,
          label: currentMode === "cluster" ? parts[1] + " / " + parts[0] + " / " + parts[2] : shortLabel(key),
          value: assets.length,
          valueLabel: String(assets.length),
          colorKey: currentMode === "scope" || currentMode === "type" ? key : assets[0].owner,
          meta: currentMode === "cluster" ? "点击下钻" : currentMode,
          assets,
          leaf: false
        };
      }).sort((a,b) => b.value - a.value);
    }

    function shortLabel(value) {
      if (value === "global") return "global";
      const parts = value.split("/");
      return parts[parts.length - 1] || value;
    }

    function treemap(nodes, x, y, w, h) {
      if (!nodes.length) return [];
      if (nodes.length === 1) return [Object.assign({}, nodes[0], { x, y, w, h })];
      const total = nodes.reduce((sum, n) => sum + n.value, 0);
      let running = nodes[0].value;
      let split = 1;
      while (split < nodes.length - 1 && running + nodes[split].value <= total / 2) {
        running += nodes[split].value;
        split += 1;
      }
      const a = nodes.slice(0, split);
      const b = nodes.slice(split);
      const ratio = a.reduce((sum,n)=>sum+n.value,0) / total;
      if (w >= h) {
        const aw = w * ratio;
        return treemap(a, x, y, aw, h).concat(treemap(b, x + aw, y, w - aw, h));
      }
      const ah = h * ratio;
      return treemap(a, x, y, w, ah).concat(treemap(b, x, y + ah, w, h - ah));
    }

    function render() {
      const current = stack[stack.length - 1];
      const q = search.value.trim().toLowerCase();
      const source = q ? current.assets.filter((a) => (a.name + " " + a.path + " " + a.owner + " " + a.type + " " + a.scope).toLowerCase().includes(q)) : current.assets;
      const nodes = nodesFor(source, current.mode);
      const rects = treemap(nodes, 0, 0, 100, 100);
      const total = Math.max(1, nodes.reduce((sum, node) => sum + node.value, 0));
      board.innerHTML = rects.map((r) => tileHtml(r, total)).join("");
      board.querySelectorAll(".tile").forEach((tile) => tile.addEventListener("click", () => selectNode(nodes.find((n) => n.id === tile.dataset.id))));
      renderCrumbs();
    }

    function tileHtml(r, total) {
      const area = r.w * r.h;
      const cls = "tile" + (area < 220 ? " compact" : "") + (area < 80 ? " tiny" : "");
      const percent = Math.round((r.value / total) * 100) + "%";
      const valueLabel = r.valueLabel || String(r.assets.length);
      return '<button class="' + cls + '" data-id="' + escAttr(r.id) + '" style="left:' + r.x + '%;top:' + r.y + '%;width:' + r.w + '%;height:' + r.h + '%;--c:' + (colors[r.colorKey] || colors.unknown) + '">' +
        '<span class="tile-label">' + esc(r.label) + '</span><span class="tile-meta">' + esc(r.meta) + '</span><strong>' + esc(valueLabel) + '</strong><em>' + percent + '</em></button>';
    }

    function selectNode(node) {
      if (!node) return;
      if (node.leaf || node.assets.length === 1) {
        showDetail(node);
        return;
      }
      const current = stack[stack.length - 1];
      const nextMode = current.mode === "type" || current.mode === "cluster" ? "assets" : "cluster";
      stack.push({ label: node.label, assets: node.assets, mode: nextMode });
      detail.classList.remove("show");
      search.value = "";
      render();
    }

    function showDetail(node) {
      const top = node.assets.slice().sort((a,b) => b.sizeBytes - a.sizeBytes).slice(0, 18);
      detail.classList.add("show");
      detail.innerHTML = '<button class="close">×</button><h2>' + esc(node.label) + '</h2><p>' + node.assets.length + ' assets · ' + esc(node.meta) + '</p>' +
        '<ol>' + top.map((a) => '<li>' + esc(a.name + ' · ' + a.type + ' · ' + a.scope + ' · ' + a.path) + '</li>').join("") + '</ol>';
      detail.querySelector(".close").addEventListener("click", () => detail.classList.remove("show"));
    }

    function renderCrumbs() {
      crumbs.innerHTML = stack.map((item, index) => '<button data-index="' + index + '">' + esc(item.label) + '</button>').join("");
      crumbs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        stack = stack.slice(0, Number(button.dataset.index) + 1);
        detail.classList.remove("show");
        render();
      }));
    }

    modeButtons.forEach((button) => button.addEventListener("click", () => {
      modeButtons.forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      mode = button.dataset.mode;
      stack = [{ label: "全部", assets: allAssets, mode }];
      detail.classList.remove("show");
      render();
    }));
    search.addEventListener("input", render);
    document.getElementById("lang").addEventListener("click", () => document.body.classList.toggle("en"));
    function bytes(n) { if (n < 1024) return n + " B"; if (n < 1024 * 1024) return Math.round(n / 1024) + " KB"; return (n / 1024 / 1024).toFixed(1) + " MB"; }
    function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
    function escAttr(value) { return esc(value).replace(/"/g, "&quot;"); }
    render();
  </script>
</body>
</html>`;
}
