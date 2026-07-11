import fs from "node:fs/promises";
import type { Asset } from "./classify.ts";
import type { Atlas } from "./scan.ts";
import { atlasHtmlPath, atlasJsonPath, dataDir } from "./paths.ts";

interface TileNode {
  id: string;
  label: string;
  value: number;
  colorKey: string;
  scopeKey: string;
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
      label: `${scope} / ${owner} / ${type}`,
      value: items.length,
      colorKey: owner,
      scopeKey: scope,
      meta: "点击下钻",
      assets: items
    };
  }).sort((a, b) => b.value - a.value);
}

function scopeNodes(assets: Asset[]): TileNode[] {
  const groups = new Map<string, Asset[]>();
  for (const asset of assets) {
    const group = groups.get(asset.scope) ?? [];
    group.push(asset);
    groups.set(asset.scope, group);
  }
  return [...groups.entries()].map(([scope, items]) => ({
    id: scope,
    label: scope,
    value: items.length,
    colorKey: scope,
    scopeKey: scope,
    meta: "点击看系统",
    assets: items
  })).sort((a, b) => b.value - a.value);
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
  return `<button class="tile${compact}${tiny}" style="left:${rect.x}%;top:${rect.y}%;width:${rect.w}%;height:${rect.h}%;--c:${color(rect.colorKey)};--s:${color(rect.scopeKey)}">
    <span class="tile-label">${escapeHtml(rect.label)}</span>
    <span class="tile-meta">${escapeHtml(rect.meta)}</span>
    <strong>${rect.value}</strong>
    <em>${pct(rect.value, total)}</em>
  </button>`;
}

function renderHtml(atlas: Atlas): string {
  const [topOwner, topOwnerCount] = topEntry(atlas.summary.byOwner);
  const [topType, topTypeCount] = topEntry(atlas.summary.byType);
  const [topScope, topScopeCount] = topEntry(atlas.summary.byScope);
  const initialRects = treemap(scopeNodes(atlas.assets), 0, 0, 100, 100);
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
    .controls { display:grid; grid-template-columns:210px repeat(6,auto); gap:8px; align-items:center; overflow-x:auto; max-width:100%; padding-bottom:2px; }
    .controls input, .controls select, .controls button { min-height:34px; border:1px solid rgba(15,23,42,.18); border-radius:8px; background:#fff; color:var(--ink); padding:0 10px; }
    .controls button.active { background:#152033; color:#fff; border-color:#152033; }
    .heatmap { position:relative; height:calc(100vh - 96px); padding:8px; background:#101826; display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:8px; }
    .crumbs { position:absolute; z-index:8; left:18px; top:18px; display:flex; gap:6px; flex-wrap:wrap; max-width:calc(100vw - 420px); }
    .crumbs button { min-height:30px; border:1px solid rgba(255,255,255,.38); border-radius:999px; background:rgba(248,250,252,.9); color:#152033; padding:0 10px; box-shadow:0 8px 28px rgba(0,0,0,.14); }
    .board { position:relative; width:100%; height:100%; overflow:hidden; border-radius:8px; background:#0f172a; box-shadow:inset 0 0 0 1px rgba(255,255,255,.12); }
    .tile { position:absolute; overflow:hidden; border:2px solid #101826; border-radius:7px; color:white; text-align:left; padding:10px; background:radial-gradient(circle at 74% 18%,rgba(255,255,255,.18),transparent 32%),linear-gradient(135deg,var(--c),#172033); box-shadow:inset 0 0 0 1px rgba(255,255,255,.14); transition:filter .12s ease,transform .12s ease,border-color .12s ease; }
    .tile::before { content:""; position:absolute; left:0; top:0; width:100%; height:5px; background:var(--s); box-shadow:0 1px 0 rgba(255,255,255,.22); }
    .tile:hover { z-index:5; filter:brightness(1.08); transform:translateY(-1px); border-color:rgba(255,255,255,.82); }
    .tile-label { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:850; font-size:clamp(11px,1.55vw,24px); text-shadow:0 1px 2px rgba(0,0,0,.28); }
    .tile-meta { display:block; margin-top:4px; color:rgba(255,255,255,.78); font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .tile strong { position:absolute; left:10px; bottom:7px; font-size:clamp(18px,3.2vw,58px); line-height:.9; letter-spacing:0; text-shadow:0 1px 2px rgba(0,0,0,.24); }
    .tile em { position:absolute; right:10px; bottom:9px; font-style:normal; color:rgba(255,255,255,.82); font-size:12px; }
    .tile.compact { padding:7px; }
    .tile.compact .tile-meta { display:none; }
    .tile.compact .tile-label { font-size:14px; }
    .tile.compact strong { font-size:clamp(14px,2vw,28px); left:7px; bottom:6px; }
    .tile.asset .tile-meta { display:none; }
    .tile.asset .tile-label { font-size:clamp(11px,1.05vw,18px); }
    .tile.asset strong { font-size:clamp(17px,2.15vw,40px); }
    .tile.tiny { padding:0; }
    .tile.tiny .tile-label, .tile.tiny .tile-meta, .tile.tiny strong, .tile.tiny em { display:none; }
    .detail { min-width:0; height:100%; overflow:auto; border:1px solid rgba(15,23,42,.18); border-radius:8px; background:rgba(248,250,252,.97); box-shadow:0 18px 50px rgba(0,0,0,.22); padding:16px; }
    .detail h2 { margin:0 0 4px; font-size:20px; letter-spacing:0; }
    .detail p { margin:0 0 12px; color:var(--muted); }
    .detail ol { margin:0; padding-left:20px; }
    .detail li { margin:7px 0; overflow-wrap:anywhere; }
    .detail .muted { color:var(--muted); }
    .detail .stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0; }
    .detail .stat { border:1px solid rgba(15,23,42,.12); border-radius:8px; padding:8px; background:#fff; }
    .detail .stat strong { display:block; font-size:20px; line-height:1.1; }
    .en [data-zh] { display:none; }
    body:not(.en) [data-en] { display:none; }
    @media (max-width:900px) { .topbar { height:170px; grid-template-columns:1fr; align-items:start; } .controls { display:flex; overflow-x:auto; } .controls input { flex:0 0 210px; } .controls select, .controls button { flex:0 0 auto; min-width:82px; } .answer { white-space:normal; } .heatmap { height:calc(100vh - 170px); padding:5px; grid-template-columns:1fr; grid-template-rows:minmax(0,1fr) 220px; } .crumbs { max-width:calc(100vw - 36px); } .detail { padding:12px; } .detail h2 { font-size:17px; } .detail ol { padding-left:18px; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div>
      <h1><span data-zh>本机 AI 资产热力图</span><span data-en>Local AI Asset Heatmap</span></h1>
      <p id="answer" class="answer">
        <span data-zh>${atlas.summary.assetCount} 个资产 · 主要集中在 ${escapeHtml(topScope)} ${topScopeCount} · 最大系统 ${escapeHtml(topOwner)} ${topOwnerCount} · 最大类型 ${escapeHtml(topType)} ${topTypeCount}</span>
        <span data-en>${atlas.summary.assetCount} assets · top scope ${escapeHtml(topScope)} ${topScopeCount} · top owner ${escapeHtml(topOwner)} ${topOwnerCount} · top type ${escapeHtml(topType)} ${topTypeCount}</span>
      </p>
    </div>
    <div class="controls">
      <input id="search" type="search" placeholder="搜索名称或路径">
      <select id="scopeFilter"><option value="">全部作用域</option></select>
      <select id="ownerFilter"><option value="">全部系统</option></select>
      <select id="typeFilter"><option value="">全部类型</option></select>
      <button data-metric="count" class="active">数量</button>
      <button data-metric="size">体积</button>
      <button id="lang"><span data-zh>English</span><span data-en>中文</span></button>
    </div>
  </header>
  <main class="heatmap">
    <nav id="crumbs" class="crumbs"></nav>
    <section id="board" class="board">${staticTiles}</section>
    <aside id="detail" class="detail">
      <h2>资产详情</h2>
      <p class="muted">悬停或点击区块查看路径、体积和修改时间。</p>
    </aside>
  </main>
  <script id="asset-data" type="application/json">${data}</script>
  <script>
    const allAssets = JSON.parse(document.getElementById("asset-data").textContent);
    const board = document.getElementById("board");
    const detail = document.getElementById("detail");
    const search = document.getElementById("search");
    const crumbs = document.getElementById("crumbs");
    const scopeFilter = document.getElementById("scopeFilter");
    const ownerFilter = document.getElementById("ownerFilter");
    const typeFilter = document.getElementById("typeFilter");
    const metricButtons = Array.prototype.slice.call(document.querySelectorAll("[data-metric]"));
    let metric = "count";
    let stack = [{ label: "全部", assets: allAssets, level: "scope" }];

    const colors = { codex:"#109182", hermes:"#7048e8", claude:"#c16620", agents:"#2f6eea", unknown:"#65758b", global:"#109182", plugin:"#7048e8", cache:"#8b5cf6", project:"#c16620", skill:"#16a34a", agent:"#2f6eea", config:"#64748b", memory:"#be123c", mcp:"#c16620", session:"#65758b" };
    const MAX_LEAF_TILES = 80;
    const LEVELS = ["scope", "owner", "source", "type", "assets"];

    function group(items, keyFn) {
      const out = new Map();
      items.forEach((asset) => {
        const key = keyFn(asset) || "unknown";
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(asset);
      });
      return out;
    }

    function setupFilters() {
      fillFilter(scopeFilter, unique(allAssets.map((asset) => asset.scope)));
      fillFilter(ownerFilter, unique(allAssets.map((asset) => asset.owner)));
      fillFilter(typeFilter, unique(allAssets.map((asset) => asset.type)));
    }

    function fillFilter(select, values) {
      values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
    }

    function unique(values) {
      return Array.from(new Set(values)).sort();
    }

    function filteredRoot() {
      return allAssets.filter((asset) => {
        if (scopeFilter.value && asset.scope !== scopeFilter.value) return false;
        if (ownerFilter.value && asset.owner !== ownerFilter.value) return false;
        if (typeFilter.value && asset.type !== typeFilter.value) return false;
        return true;
      });
    }

    function nodesFor(items, level) {
      if (level === "assets") {
        const sorted = items.slice().sort((a,b) => b.sizeBytes - a.sizeBytes);
        const visible = sorted.slice(0, MAX_LEAF_TILES);
        const rest = sorted.slice(MAX_LEAF_TILES);
        const nodes = visible.map((asset) => ({ id: asset.id, label: asset.name, value: Math.max(1, Math.round(asset.sizeBytes / 1024)), valueLabel: bytes(asset.sizeBytes), colorKey: asset.owner, scopeKey: asset.scope, meta: asset.scope + " / " + asset.owner + " / " + asset.type + " · " + bytes(asset.sizeBytes), assets: [asset], leaf: true }));
        if (rest.length) {
          const size = rest.reduce((sum, asset) => sum + asset.sizeBytes, 0);
          nodes.push({ id: "other:" + rest.length, label: "其他 " + rest.length, value: Math.max(1, Math.round(size / 1024)), valueLabel: bytes(size), colorKey: dominant(rest, "owner"), scopeKey: dominant(rest, "scope"), meta: scopeMix(rest), assets: rest, leaf: true });
        }
        return nodes.sort((a,b) => b.value - a.value);
      }
      const keyFn = {
        scope: (a) => a.scope,
        owner: (a) => a.owner,
        source: (a) => sourceGroup(a),
        type: (a) => a.type
      }[level];
      return Array.from(group(items, keyFn).entries()).map(([key, assets]) => {
        const value = metric === "size" ? assets.reduce((sum, asset) => sum + asset.sizeBytes, 0) : assets.length;
        return {
          id: key,
          label: labelFor(level, key),
          value: metric === "size" ? Math.max(1, Math.round(value / 1024)) : value,
          valueLabel: metric === "size" ? bytes(value) : String(value),
          colorKey: level === "scope" || level === "type" ? key : dominant(assets, "owner"),
          scopeKey: dominant(assets, "scope"),
          meta: metaFor(level, assets),
          assets,
          leaf: false
        };
      }).sort((a,b) => b.value - a.value);
    }

    function sourceGroup(asset) {
      const parts = asset.path.split("/");
      const pluginIndex = parts.lastIndexOf("plugins");
      if (pluginIndex >= 0 && parts[pluginIndex + 1]) return "plugin: " + parts[pluginIndex + 1];
      const tmpPluginIndex = parts.findIndex((part, index) => part === ".tmp" && parts[index + 1] === "plugins");
      if (tmpPluginIndex >= 0 && parts[tmpPluginIndex + 3]) return "plugin: " + parts[tmpPluginIndex + 3];
      if (asset.projectPath) return "project: " + shortLabel(asset.projectPath);
      const skillIndex = parts.lastIndexOf("skills");
      if (skillIndex >= 0) return asset.scope + ": " + asset.owner + " skills";
      const agentIndex = Math.max(parts.lastIndexOf("agents"), parts.lastIndexOf("subagents"));
      if (agentIndex >= 0) return asset.scope + ": " + asset.owner + " agents";
      return asset.scope + ": " + asset.owner + " " + asset.type;
    }

    function labelFor(level, key) {
      if (level === "source") return shortSourceLabel(key);
      return key;
    }

    function shortSourceLabel(value) {
      if (value.startsWith("plugin: ")) return value.slice(8);
      if (value.startsWith("project: ")) return value.slice(9);
      return value;
    }

    function metaFor(level, assets) {
      const next = { scope:"系统", owner:"来源", source:"类型", type:"资产" }[level];
      return scopeMix(assets) + " · 点击看" + next;
    }

    function dominant(items, field) {
      const counts = {};
      items.forEach((item) => counts[item[field]] = (counts[item[field]] || 0) + 1);
      return Object.entries(counts).sort((a,b) => b[1] - a[1])[0][0] || "unknown";
    }

    function scopeMix(items) {
      const counts = {};
      items.forEach((item) => counts[item.scope] = (counts[item.scope] || 0) + 1);
      return Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([scope, count]) => scope + ":" + count).join(" ");
    }

    function shortLabel(value) {
      if (value === "global") return "global";
      if (value === "plugin/cache") return "plugin/cache";
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
      const source = q ? current.assets.filter((a) => (a.name + " " + a.path + " " + a.owner + " " + a.type + " " + a.scope + " " + sourceGroup(a)).toLowerCase().includes(q)) : current.assets;
      const nodes = nodesFor(source, current.level);
      const crumbSpace = stack.length > 1 ? 6 : 0;
      const rects = treemap(nodes, 0, crumbSpace, 100, 100 - crumbSpace);
      const total = Math.max(1, nodes.reduce((sum, node) => sum + node.value, 0));
      board.innerHTML = rects.map((r) => tileHtml(r, total)).join("");
      board.querySelectorAll(".tile").forEach((tile) => {
        const node = nodes.find((n) => n.id === tile.dataset.id);
        tile.addEventListener("mouseenter", () => showDetail(node));
        tile.addEventListener("focus", () => showDetail(node));
        tile.addEventListener("click", () => selectNode(node));
      });
      renderCrumbs();
      showSummary(current, nodes);
    }

    function tileHtml(r, total) {
      const area = r.w * r.h;
      const cls = "tile" + (r.leaf ? " asset" : "") + (area < 220 ? " compact" : "") + (area < 80 ? " tiny" : "");
      const percent = Math.round((r.value / total) * 100) + "%";
      const valueLabel = r.valueLabel || String(r.assets.length);
      return '<button class="' + cls + '" data-id="' + escAttr(r.id) + '" style="left:' + r.x + '%;top:' + r.y + '%;width:' + r.w + '%;height:' + r.h + '%;--c:' + (colors[r.colorKey] || colors.unknown) + ';--s:' + (colors[r.scopeKey] || colors.unknown) + '">' +
        '<span class="tile-label">' + esc(r.label) + '</span><span class="tile-meta">' + esc(r.meta) + '</span><strong>' + esc(valueLabel) + '</strong><em>' + percent + '</em></button>';
    }

    function selectNode(node) {
      if (!node) return;
      if (node.leaf || node.assets.length === 1) {
        showDetail(node);
        return;
      }
      const current = stack[stack.length - 1];
      const nextLevel = nextDrillLevel(current.level);
      stack.push({ label: node.label, assets: node.assets, level: nextLevel });
      search.value = "";
      render();
    }

    function nextDrillLevel(level) {
      const index = LEVELS.indexOf(level);
      return LEVELS[Math.min(index + 1, LEVELS.length - 1)];
    }

    function showDetail(node) {
      if (!node) return;
      const top = node.assets.slice().sort((a,b) => b.sizeBytes - a.sizeBytes).slice(0, 18);
      const size = node.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
      detail.innerHTML = '<h2>' + esc(node.label) + '</h2><p>' + node.assets.length + ' 个资产 · ' + esc(scopeMix(node.assets)) + '</p>' +
        '<div class="stats"><div class="stat"><span>数量</span><strong>' + node.assets.length + '</strong></div><div class="stat"><span>体积</span><strong>' + esc(bytes(size)) + '</strong></div></div>' +
        '<ol>' + top.map((a) => '<li><strong>' + esc(a.scope + ' / ' + a.owner + ' / ' + a.type) + '</strong><br>' + esc(a.name + ' · ' + bytes(a.sizeBytes) + ' · ' + date(a.modifiedAt)) + '<br>' + esc(a.path) + '</li>').join("") + '</ol>';
    }

    function showSummary(current, nodes) {
      const size = current.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
      const top = nodes.slice(0, 8);
      detail.innerHTML = '<h2>' + esc(current.label) + '</h2><p class="muted">' + esc(levelName(current.level)) + ' · ' + current.assets.length + ' 个资产</p>' +
        '<div class="stats"><div class="stat"><span>数量</span><strong>' + current.assets.length + '</strong></div><div class="stat"><span>体积</span><strong>' + esc(bytes(size)) + '</strong></div></div>' +
        '<ol>' + top.map((node) => '<li><strong>' + esc(node.label) + '</strong><br>' + esc(node.valueLabel + ' · ' + node.meta) + '</li>').join("") + '</ol>';
    }

    function levelName(level) {
      return { scope:"作用域", owner:"系统", source:"来源", type:"类型", assets:"资产" }[level] || level;
    }

    function renderCrumbs() {
      crumbs.innerHTML = stack.map((item, index) => '<button data-index="' + index + '">' + esc(item.label) + '</button>').join("");
      crumbs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        stack = stack.slice(0, Number(button.dataset.index) + 1);
        render();
      }));
    }

    function resetToRoot() {
      const assets = filteredRoot();
      stack = [{ label: rootLabel(), assets, level: rootLevel() }];
      render();
    }

    function rootLabel() {
      const parts = [scopeFilter.value, ownerFilter.value, typeFilter.value].filter(Boolean);
      return parts.length ? parts.join(" / ") : "全部";
    }

    function rootLevel() {
      if (scopeFilter.value === "project") return "source";
      if (scopeFilter.value && ownerFilter.value) return "source";
      if (scopeFilter.value) return "owner";
      return "scope";
    }

    metricButtons.forEach((button) => button.addEventListener("click", () => {
      metricButtons.forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      metric = button.dataset.metric;
      render();
    }));
    search.addEventListener("input", render);
    [scopeFilter, ownerFilter, typeFilter].forEach((select) => select.addEventListener("change", resetToRoot));
    document.getElementById("lang").addEventListener("click", () => document.body.classList.toggle("en"));
    function bytes(n) { if (n < 1024) return n + " B"; if (n < 1024 * 1024) return Math.round(n / 1024) + " KB"; return (n / 1024 / 1024).toFixed(1) + " MB"; }
    function date(value) { return String(value || "").slice(0, 10); }
    function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
    function escAttr(value) { return esc(value).replace(/"/g, "&quot;"); }
    setupFilters();
    resetToRoot();
  </script>
</body>
</html>`;
}
