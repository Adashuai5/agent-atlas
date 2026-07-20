import fs from "node:fs/promises";
import path from "node:path";
import type { Atlas } from "./scan.ts";
import { buildSnapshot, renderContextMarkdown } from "./diagnose.ts";
import { atlasContextJsonPath, atlasContextMarkdownPath, atlasHtmlPath, atlasJsonPath, dataDir } from "./paths.ts";

type ContextLanguage = "zh" | "en";

export function fullContextFileName(scopeIndex: number, language: ContextLanguage): string {
  const stem = scopeIndex === 0 ? "atlas-context-full" : `atlas-context-project-${scopeIndex}-full`;
  return language === "en" ? `${stem}.md` : `${stem}.zh.md`;
}

export async function writeAtlas(atlas: Atlas): Promise<void> {
  const snapshot = buildSnapshot(atlas, null);
  const projectPaths = [...new Set(atlas.projects.map((project) => project.projectPath ?? project.path))];
  const scopeSnapshots = [snapshot, ...projectPaths.map((projectPath) => buildSnapshot(atlas, projectPath))];
  const fullContextFiles = scopeSnapshots.map((_, scopeIndex) => ({
    zh: fullContextFileName(scopeIndex, "zh"),
    en: fullContextFileName(scopeIndex, "en")
  }));
  await fs.mkdir(dataDir, { recursive: true });
  const fullContextWrites = scopeSnapshots.flatMap((scope, scopeIndex) => (["zh", "en"] as ContextLanguage[]).map((language) =>
    fs.writeFile(
      path.join(dataDir, fullContextFiles[scopeIndex][language]),
      renderContextMarkdown(scope, language, { full: true }),
      "utf8"
    )
  ));
  await Promise.all([
    fs.writeFile(atlasJsonPath, `${JSON.stringify(atlas, null, 2)}\n`, "utf8"),
    fs.writeFile(atlasContextJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"),
    fs.writeFile(atlasContextMarkdownPath, renderContextMarkdown(snapshot, "en", { fullContextPath: `data/${fullContextFiles[0].en}` }), "utf8"),
    fs.writeFile(atlasHtmlPath, renderHtml(snapshot, scopeSnapshots, fullContextFiles), "utf8"),
    ...fullContextWrites
  ]);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function compactSnapshotForHtml(snapshot: ReturnType<typeof buildSnapshot>, includePluginResources: boolean) {
  const issues = snapshot.issues.map((issue) => issue.id === "plugin-lifecycle" ? { ...issue, assetIds: [] } : issue);
  const issueAssetIds = new Set(issues.flatMap((issue) => issue.assetIds));
  const resources = snapshot.resources
    .filter((resource) => (resource.effective || issueAssetIds.has(resource.id) || (includePluginResources && resource.type === "plugin")) && (includePluginResources || resource.type !== "plugin"))
    .map((resource) => ({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      owner: resource.owner,
      scope: resource.scope,
      path: resource.path,
      health: resource.health,
      confidence: resource.confidence,
      effective: resource.effective,
      consumer: resource.consumer,
      states: {
        present: { value: resource.states.present.value },
        valid: { value: resource.states.valid.value },
        enabled: { value: resource.states.enabled.value },
        loaded: { value: resource.states.loaded.value }
      },
      reason: resource.health === "warning" || resource.health === "attention" ? resource.reason : "",
      reasonEn: resource.health === "warning" || resource.health === "attention" ? resource.reasonEn : ""
    }));
  return { ...snapshot, resources, issues, diagnoses: [], plugins: [] };
}

export function renderHtml(
  snapshot: ReturnType<typeof buildSnapshot>,
  scopeSnapshots: ReturnType<typeof buildSnapshot>[],
  fullContextFiles = scopeSnapshots.map((_, scopeIndex) => ({
    zh: fullContextFileName(scopeIndex, "zh"),
    en: fullContextFileName(scopeIndex, "en")
  }))
): string {
  const scopesData = JSON.stringify(scopeSnapshots.map((scope, index) => compactSnapshotForHtml(scope, index === 0))).replace(/</g, "\\u003c");
  const contextsData = JSON.stringify(scopeSnapshots.map((scope, index) => ({
    zh: renderContextMarkdown(scope, "zh", { fullContextPath: `data/${fullContextFiles[index].zh}` }),
    en: renderContextMarkdown(scope, "en", { fullContextPath: `data/${fullContextFiles[index].en}` })
  }))).replace(/</g, "\\u003c");
  const fullContextsData = JSON.stringify(fullContextFiles).replace(/</g, "\\u003c");
  const actionableIssues = snapshot.issues.filter((issue) => issue.severity === "warning" || issue.severity === "attention").length;
  const projectLabel = snapshot.project?.name ?? "本机全局环境";
  const generated = snapshot.generatedAt.slice(0, 16).replace("T", " ");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Atlas · ${escapeHtml(projectLabel)}</title>
  <style>
    :root {
      --canvas:#eef1f5; --surface:#fff; --ink:#142033; --muted:#68758a; --line:#dce2ea;
      --healthy:#12825f; --healthy-2:#075c46; --attention:#d58b16; --attention-2:#9a5a08;
      --warning:#c7483b; --warning-2:#8f2d27; --inactive:#718096; --inactive-2:#48566a;
      --shadow:0 16px 42px rgba(25,39,61,.09);
    }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--canvas); color:var(--ink); font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button,input { font:inherit; }
    button { cursor:pointer; }
    .app { width:min(1500px,100%); margin:0 auto; padding:18px; }
    .topbar { display:flex; justify-content:space-between; align-items:center; gap:18px; margin-bottom:14px; }
    .brand { display:flex; align-items:center; gap:11px; min-width:0; }
    .mark { width:38px; height:38px; border-radius:11px; display:grid; place-items:center; background:#142033; color:#fff; font-weight:900; letter-spacing:-1px; }
    h1 { margin:0; font-size:18px; line-height:1.15; }
    .context { margin:3px 0 0; color:var(--muted); }
    .scopeControls { display:flex; align-items:center; gap:6px; margin-top:3px; }
    .scopeSelect { max-width:240px; height:30px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); padding:0 8px; }
    .scopeSelect[hidden] { display:none; }
    .meta { color:var(--muted); font-size:12px; text-align:right; }
    .metaControls { display:flex; justify-content:flex-end; align-items:center; gap:9px; margin-top:3px; }
    .aiButton,.pluginButton,.langButton { border:0; background:transparent; color:#315e9a; padding:0; }
    .langButton { color:#526178; }
    .fullContextLink { display:inline-flex; align-items:center; min-height:34px; border:1px solid var(--line); border-radius:8px; color:#315e9a; padding:0 10px; text-decoration:none; }
    .hero { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:22px; align-items:center; padding:22px 24px; border-radius:16px; background:#142033; color:#fff; box-shadow:var(--shadow); }
    .eyebrow { display:flex; align-items:center; gap:8px; color:rgba(255,255,255,.68); font-size:12px; font-weight:700; letter-spacing:.04em; }
    .statusDot { width:9px; height:9px; border-radius:50%; background:var(--status); box-shadow:0 0 0 4px color-mix(in srgb,var(--status),transparent 78%); }
    .hero h2 { margin:8px 0 0; max-width:850px; font-size:clamp(22px,3vw,38px); line-height:1.08; letter-spacing:-.035em; }
    .hero p { margin:9px 0 0; max-width:820px; color:rgba(255,255,255,.72); font-size:15px; }
    .heroStats { display:flex; gap:10px; }
    .heroStat { min-width:96px; padding:12px 14px; border:1px solid rgba(255,255,255,.15); border-radius:12px; background:rgba(255,255,255,.06); }
    .heroStat span { display:block; color:rgba(255,255,255,.62); font-size:11px; }
    .heroStat strong { display:block; margin-top:3px; font-size:24px; line-height:1; }
    .overview { display:grid; grid-template-columns:minmax(0,2.2fr) minmax(280px,.8fr); gap:14px; margin-top:14px; }
    .panel { min-width:0; border:1px solid var(--line); border-radius:16px; background:var(--surface); box-shadow:var(--shadow); overflow:hidden; }
    .panelHead { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding:17px 18px 13px; border-bottom:1px solid var(--line); }
    .panelHead h3 { margin:0; font-size:17px; }
    .panelHead p { margin:4px 0 0; color:var(--muted); font-size:12px; }
    .legend { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; color:var(--muted); font-size:11px; }
    .legend span { display:flex; align-items:center; gap:5px; white-space:nowrap; }
    .legend i { width:8px; height:8px; border-radius:50%; background:var(--dot); }
    .mapBoard { height:clamp(440px,61vh,700px); display:flex; gap:5px; padding:6px; background:#111a2a; overflow:auto; }
    .systemGroup { position:relative; flex-basis:0; min-width:110px; border:1px solid rgba(255,255,255,.18); border-radius:8px; overflow:hidden; background:#1d293c; }
    .systemHead { position:absolute; z-index:3; left:0; right:0; top:0; height:38px; display:flex; justify-content:space-between; align-items:center; gap:8px; padding:0 10px; border:0; border-bottom:1px solid rgba(255,255,255,.18); background:rgba(10,17,29,.9); color:#fff; text-align:left; }
    .systemHead strong { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .systemHead span { width:8px; height:8px; flex:0 0 auto; border-radius:50%; background:var(--status); }
    .systemTiles { position:absolute; left:0; right:0; top:38px; bottom:0; }
    .tile { position:absolute; overflow:hidden; border:2px solid #111a2a; border-radius:5px; padding:10px; color:#fff; text-align:left; background:linear-gradient(145deg,var(--tile),var(--tile-dark)); transition:filter .12s ease,transform .12s ease; }
    .tile:hover,.tile:focus-visible { z-index:4; filter:brightness(1.12); transform:translateY(-1px); outline:2px solid rgba(255,255,255,.9); outline-offset:-3px; }
    .tileLabel { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:clamp(12px,1.35vw,21px); font-weight:800; text-shadow:0 1px 2px rgba(0,0,0,.25); }
    .tileState { display:block; margin-top:4px; color:rgba(255,255,255,.78); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tile.compact { padding:7px; }
    .tile.compact .tileLabel { font-size:12px; }
    .tile.compact .tileState { display:none; }
    .tile.tiny { padding:0; }
    .tile.tiny .tileLabel,.tile.tiny .tileState { display:none; }
    .issuesPanel { display:grid; grid-template-rows:auto minmax(0,1fr); }
    .issueList { overflow:auto; padding:8px; }
    .issue { width:100%; display:block; margin-bottom:7px; padding:12px; border:1px solid var(--line); border-left:4px solid var(--issue); border-radius:10px; background:#fff; color:var(--ink); text-align:left; }
    .issue:hover { background:#f7f9fc; }
    .issue strong { display:block; font-size:13px; }
    .issue p { margin:5px 0 0; color:var(--muted); font-size:12px; }
    .issue .next { color:#405570; }
    .quiet { padding:22px; color:var(--muted); text-align:center; }
    .detailView { display:none; margin-top:14px; }
    .detailView.open { display:block; }
    .back { border:0; background:transparent; color:#315e9a; padding:0; }
    .detailTop { padding:18px; border-bottom:1px solid var(--line); }
    .detailTitle { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-top:12px; }
    .detailTitle h2 { margin:0; font-size:28px; letter-spacing:-.025em; }
    .detailTitle p { margin:4px 0 0; color:var(--muted); }
    .search { width:min(330px,100%); height:38px; border:1px solid var(--line); border-radius:9px; padding:0 11px; background:#f8fafc; color:var(--ink); }
    .chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:13px; }
    .chip { border:1px solid var(--line); border-radius:999px; background:#fff; color:#4f5e73; padding:5px 9px; font-size:12px; }
    button.chip.active { border-color:#142033; background:#142033; color:#fff; }
    .resourceList { padding:6px 18px 18px; }
    .resourceHeader,.resourceRow { display:grid; grid-template-columns:minmax(160px,1.05fr) 105px 120px minmax(160px,1fr) minmax(210px,1.35fr); gap:14px; align-items:start; }
    .resourceHeader { padding:10px 18px; border-bottom:1px solid var(--line); background:#f7f9fc; color:var(--muted); font-size:11px; font-weight:700; }
    .resourceRow { padding:13px 0; border-bottom:1px solid var(--line); }
    .resourceRow:last-child { border-bottom:0; }
    .resourceName strong { display:block; overflow-wrap:anywhere; }
    .resourceName span,.resourcePath,.resourceReason { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
    .badge { display:inline-flex; align-items:center; gap:6px; width:max-content; padding:4px 8px; border-radius:999px; background:color-mix(in srgb,var(--badge),white 87%); color:color-mix(in srgb,var(--badge),black 20%); font-size:11px; font-weight:700; }
    .badge i { width:7px; height:7px; border-radius:50%; background:var(--badge); }
    .empty { padding:35px; color:var(--muted); text-align:center; }
    .modal { position:fixed; z-index:50; inset:0; display:none; place-items:center; padding:20px; background:rgba(9,17,29,.62); }
    .modal.open { display:grid; }
    .modalCard { width:min(880px,100%); max-height:min(820px,92vh); display:grid; grid-template-rows:auto minmax(0,1fr); border-radius:15px; background:#fff; box-shadow:0 30px 90px rgba(0,0,0,.3); overflow:hidden; }
    .modalHead { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:14px 16px; border-bottom:1px solid var(--line); }
    .modalHead h3 { margin:0; }
    .modalActions { display:flex; gap:7px; }
    .modalActions button { min-height:34px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); padding:0 10px; }
    .modalActions button.primary { background:#142033; border-color:#142033; color:#fff; }
    .aiContext { margin:0; padding:18px; overflow:auto; background:#f7f9fc; color:#25334a; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
    @media (max-width:900px) {
      .app { padding:10px; }
      .topbar { align-items:flex-start; }
      .meta { font-size:0; }
      .metaControls,.aiButton,.pluginButton,.langButton { font-size:12px; }
      .hero { grid-template-columns:1fr; padding:18px; }
      .heroStats { overflow-x:auto; }
      .heroStat { min-width:88px; }
      .overview { grid-template-columns:1fr; }
      .mapBoard { height:500px; }
      .systemGroup { min-width:145px; }
      .issuesPanel { max-height:360px; }
      .detailTitle { display:block; }
      .search { margin-top:13px; }
      .resourceHeader { display:none; }
      .resourceRow { grid-template-columns:minmax(0,1fr) auto; gap:8px 12px; }
      .resourceSource,.resourceReason,.resourcePath { grid-column:1 / -1; }
    }
    @media (max-width:520px) {
      .topbar { display:grid; grid-template-columns:minmax(0,1fr); }
      .meta { min-width:0; text-align:left; }
      .metaControls { justify-content:flex-start; flex-wrap:wrap; }
      .scopeControls { max-width:285px; }
      .scopeSelect { min-width:0; max-width:180px; }
      .hero h2 { font-size:24px; overflow-wrap:anywhere; }
      .heroStats { gap:7px; }
      .heroStat { padding:10px; }
      .panelHead { display:block; }
      .legend { justify-content:flex-start; margin-top:10px; }
      .mapBoard { height:430px; }
      .systemGroup { min-width:130px; }
      .mapBoard { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); height:auto; max-height:560px; }
      .systemGroup { min-width:0; height:240px; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div class="brand">
        <div class="mark">A</div>
        <div><h1>Agent Atlas</h1><div class="scopeControls"><select id="scopeMode" class="scopeSelect" aria-label="范围类型"><option value="global">本机全局</option><option value="project">项目</option></select><select id="projectSelect" class="scopeSelect" aria-label="具体项目" hidden>${scopeSnapshots.slice(1).map((scope, index) => `<option value="${index + 1}">${escapeHtml(scope.project?.name ?? "Project")}</option>`).join("")}</select></div></div>
      </div>
      <div class="meta"><span data-i18n="lastScan">最后扫描</span> ${escapeHtml(generated)}<div class="metaControls"><button id="showPlugins" class="pluginButton">Plugin ${snapshot.stats.plugins}</button><button id="showAiContext" class="aiButton" data-i18n="aiContext">给 AI 的上下文 ↗</button><button id="langToggle" class="langButton">中 / EN</button></div></div>
    </header>

    <section id="hero" class="hero" style="--status:var(--${snapshot.conclusion.health})">
      <div>
        <div class="eyebrow"><i class="statusDot"></i><span data-i18n="currentConclusion">当前结论</span></div>
        <h2 id="conclusionTitle">${escapeHtml(snapshot.conclusion.title)}</h2>
        <p id="conclusionDetail">${escapeHtml(snapshot.conclusion.detail)}</p>
      </div>
      <div class="heroStats">
        <div class="heroStat"><span id="statOneLabel">运行时</span><strong id="statOneValue">${snapshot.systems.length}</strong></div>
        <div class="heroStat"><span id="statTwoLabel">资源面可见</span><strong id="statTwoValue">${snapshot.stats.effective}</strong></div>
        <div class="heroStat"><span id="statThreeLabel">待确认</span><strong id="statThreeValue">${actionableIssues}</strong></div>
      </div>
    </section>

    <section id="overview" class="overview">
      <article class="panel">
        <header class="panelHead">
          <div><h3 data-i18n="systemStatus">当前运行时状态</h3><p id="mapHelp">面积只表示资源面库存规模，不代表实际加载、使用或影响。</p></div>
          <div class="legend">
            <span><i style="--dot:var(--healthy)"></i><b data-i18n="healthy">正常</b></span>
            <span><i style="--dot:var(--attention)"></i><b data-i18n="attention">待确认</b></span>
            <span><i style="--dot:var(--warning)"></i><b data-i18n="warning">冲突</b></span>
            <span><i style="--dot:var(--inactive)"></i><b data-i18n="inactive">不可见</b></span>
          </div>
        </header>
        <div id="mapBoard" class="mapBoard"></div>
      </article>
      <aside class="panel issuesPanel">
        <header class="panelHead"><div><h3 data-i18n="diagnostics">诊断关系</h3><p data-i18n="issueHelp">warning、attention 与健康/info 关系均保留证据。</p></div></header>
        <div id="issueList" class="issueList"></div>
      </aside>
    </section>

    <section id="detailView" class="panel detailView">
      <div class="detailTop">
        <button id="back" class="back" data-i18n="back">← 返回系统总览</button>
        <div class="detailTitle">
          <div><h2 id="detailHeading">资源</h2><p id="detailSummary"></p></div>
          <input id="detailSearch" class="search" type="search" placeholder="搜索名称或路径">
        </div>
        <div id="chips" class="chips"></div>
      </div>
      <div class="resourceHeader"><span data-i18n="name">名称</span><span data-i18n="status">状态</span><span data-i18n="source">来源</span><span data-i18n="basis">判断依据</span><span data-i18n="path">路径</span></div>
      <div id="resourceList" class="resourceList"></div>
    </section>

    <section id="aiModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="aiModalTitle">
      <div class="modalCard">
        <header class="modalHead"><h3 id="aiModalTitle" data-i18n="aiModalTitle">给 AI 的当前上下文</h3><div class="modalActions"><a id="fullContextLink" class="fullContextLink" href="atlas-context-full.zh.md" data-i18n="fullContext">完整上下文</a><button id="copyAiContext" class="primary" data-i18n="copyMarkdown">复制 Markdown</button><button id="closeAiContext" data-i18n="close">关闭</button></div></header>
        <pre id="aiContext" class="aiContext"></pre>
      </div>
    </section>
  </main>

  <script>
    const scopeSnapshots = ${scopesData};
    const scopeContexts = ${contextsData};
    const fullContextFiles = ${fullContextsData};
    let snapshot = scopeSnapshots[0];
    const overview = document.getElementById("overview");
    const detailView = document.getElementById("detailView");
    const mapBoard = document.getElementById("mapBoard");
    const issueList = document.getElementById("issueList");
    const detailSearch = document.getElementById("detailSearch");
    const translations = {
      zh:{ lastScan:"最后扫描",aiContext:"给 AI 的上下文 ↗",currentConclusion:"当前结论",systems:"运行时",visible:"资源面可见",direct:"直接配置",inherited:"继承全局",review:"待确认",systemStatus:"当前运行时状态",mapGlobalHelp:"面积只表示资源面库存规模，不代表实际加载、使用或影响。",mapProjectHelp:"项目级联按优先级投影；面积仍只表示资源面库存规模。",healthy:"正常",attention:"待确认",warning:"冲突",inactive:"不可见",diagnostics:"诊断关系",issueHelp:"warning、attention 与 healthy/info 关系均保留证据。",back:"← 返回系统总览",aiModalTitle:"给 AI 的当前上下文",fullContext:"完整上下文",copyMarkdown:"复制 Markdown",close:"关闭",next:"建议",scopeProject:"当前项目",scopeGlobal:"本机全局",search:"搜索名称、路径或状态",emptyIssues:"当前没有诊断项。",emptyResources:"没有匹配资源",resourceSummary:"个匹配资源；列表优先显示冲突和待确认项。",confidence:"置信度",lifecycle:"四态",omitted:"条未显示",copied:"已复制",all:"全部",name:"名称",status:"状态",source:"存储来源",basis:"判断依据",path:"路径" },
      en:{ lastScan:"Last scan",aiContext:"AI context ↗",currentConclusion:"Current conclusion",systems:"Runtimes",visible:"Surface visible",direct:"Direct config",inherited:"Inherited",review:"Review",systemStatus:"Current runtime status",mapGlobalHelp:"Area represents inventory surface only, not actual loading, use, or influence.",mapProjectHelp:"Project cascade is projected by priority; area still represents inventory surface only.",healthy:"Healthy",attention:"Review",warning:"Conflict",inactive:"Not visible",diagnostics:"Diagnostic relations",issueHelp:"Warnings, attention items, and healthy/info relations all retain evidence.",back:"← Back to system overview",aiModalTitle:"Current context for AI",fullContext:"Full context",copyMarkdown:"Copy Markdown",close:"Close",next:"Next",scopeProject:"Current project",scopeGlobal:"Global machine",search:"Search name, path, or state",emptyIssues:"No diagnostic item in this scope.",emptyResources:"No matching resources",resourceSummary:" matching resources; conflicts and uncertain items appear first.",confidence:"Confidence",lifecycle:"Four states",omitted:"items omitted",copied:"Copied",all:"All",name:"Name",status:"Status",source:"Storage source",basis:"Assessment basis",path:"Path" }
    };
    const typeLabelsByLang = {
      zh:{ skill:"技能",memory:"记忆",mcp:"MCP",agent:"Agent",config:"配置",project:"项目",session:"会话",plugin:"Plugin" },
      en:{ skill:"Skills",memory:"Memory",mcp:"MCP",agent:"Agents",config:"Config",project:"Project",session:"Sessions",plugin:"Plugin" }
    };
    const healthLabelsByLang = {
      zh:{ healthy:"状态正常",attention:"需要确认",warning:"存在冲突",inactive:"不可见" },
      en:{ healthy:"Healthy",attention:"Needs review",warning:"Conflict",inactive:"Not visible" }
    };
    const confidenceLabels = { zh:{confirmed:"已确认",inferred:"推定",unknown:"未知"}, en:{confirmed:"Confirmed",inferred:"Inferred",unknown:"Unknown"} };
    const healthColors = {
      healthy:["#138965","#075c46"], attention:["#de961d","#965608"],
      warning:["#cf4c40","#8b2c27"], inactive:["#718096","#455267"]
    };
    let detailFilter = null;
    let detailHealthFilter = "all";
    let language = "zh";

    function t(key) { return translations[language][key] || key; }
    function healthLabel(health) { return healthLabelsByLang[language][health] || health; }
    function typeLabel(type) { return typeLabelsByLang[language][type] || type; }

    function applyLanguage() {
      document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
      document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
      detailSearch.placeholder = t("search");
      const scopeMode = document.getElementById("scopeMode");
      const selectedMode = scopeMode.value || "global";
      scopeMode.innerHTML = '<option value="global">'+esc(t("scopeGlobal"))+'</option><option value="project"'+(scopeSnapshots.length < 2 ? ' disabled' : '')+'>'+esc(t("scopeProject"))+'</option>';
      scopeMode.value = selectedMode;
      const projectSelect = document.getElementById("projectSelect");
      const selectedProject = projectSelect.value || "1";
      projectSelect.innerHTML = scopeSnapshots.slice(1).map((scope,index) => '<option value="'+(index+1)+'">'+esc(scope.project?.name || "Project")+'</option>').join("");
      if (scopeSnapshots.length > 1) projectSelect.value = selectedProject;
    }

    function currentScopeIndex() {
      return document.getElementById("scopeMode").value === "project" ? Number(document.getElementById("projectSelect").value || 1) : 0;
    }

    function updateFullContextLink() {
      document.getElementById("fullContextLink").href = fullContextFiles[currentScopeIndex()]?.[language] || fullContextFiles[0][language];
    }

    function applyScope() {
      const projectMode = document.getElementById("scopeMode").value === "project";
      document.getElementById("projectSelect").hidden = !projectMode;
      snapshot = scopeSnapshots[currentScopeIndex()] || scopeSnapshots[0];
      updateFullContextLink();
      detailView.classList.remove("open");
      overview.style.display = "grid";
      detailFilter = null;
      renderHeader();
      renderMap();
      renderIssues();
    }

    function renderHeader() {
      const actionable = snapshot.issues.filter((issue) => issue.severity === "warning" || issue.severity === "attention").length;
      const hero = document.getElementById("hero");
      hero.style.setProperty("--status", "var(--" + snapshot.conclusion.health + ")");
      document.getElementById("conclusionTitle").textContent = language === "zh" ? snapshot.conclusion.title : snapshot.conclusion.titleEn;
      document.getElementById("conclusionDetail").textContent = language === "zh" ? snapshot.conclusion.detail : snapshot.conclusion.detailEn;
      const projectScope = Boolean(snapshot.project);
      document.getElementById("statOneLabel").textContent = projectScope ? t("direct") : t("systems");
      document.getElementById("statOneValue").textContent = projectScope ? snapshot.stats.direct : snapshot.systems.length;
      document.getElementById("statTwoLabel").textContent = projectScope ? t("inherited") : t("visible");
      document.getElementById("statTwoValue").textContent = projectScope ? snapshot.stats.inherited : snapshot.stats.effective;
      document.getElementById("statThreeLabel").textContent = t("review");
      document.getElementById("statThreeValue").textContent = actionable;
      document.getElementById("showPlugins").textContent = "Plugin " + snapshot.stats.plugins;
      document.getElementById("mapHelp").textContent = t(projectScope && snapshot.stats.direct > 0 ? "mapProjectHelp" : "mapGlobalHelp");
    }

    function worst(items) {
      const rank = { healthy:0, inactive:0, attention:1, warning:2 };
      return items.slice().sort((a,b) => rank[b.health] - rank[a.health])[0]?.health || "healthy";
    }

    function layout(nodes, x, y, w, h) {
      if (!nodes.length) return [];
      if (nodes.length === 1) return [Object.assign({}, nodes[0], { x:x, y:y, w:w, h:h })];
      const total = nodes.reduce((sum,node) => sum + node.value, 0);
      let running = nodes[0].value;
      let split = 1;
      while (split < nodes.length - 1 && running + nodes[split].value <= total / 2) { running += nodes[split].value; split += 1; }
      const a = nodes.slice(0, split);
      const b = nodes.slice(split);
      const ratio = a.reduce((sum,node) => sum + node.value, 0) / total;
      if (w >= h) return layout(a,x,y,w*ratio,h).concat(layout(b,x+w*ratio,y,w*(1-ratio),h));
      return layout(a,x,y,w,h*ratio).concat(layout(b,x,y+h*ratio,w,h*(1-ratio)));
    }

    function renderMap() {
      const total = Math.max(1, snapshot.systems.reduce((sum,system) => sum + system.resourceSurfaceWeight, 0));
      mapBoard.innerHTML = snapshot.systems.map((system) => {
        const nodes = Object.entries(system.byType).map(([type,count]) => {
          const resources = snapshot.resources.filter((item) => item.effective && item.consumer === system.consumer && item.type === type);
          return { id:type, label:typeLabel(type), value:system.byTypeSurfaceWeight[type] || 1, count:count, health:worst(resources) };
        }).sort((a,b) => b.value-a.value);
        const tiles = layout(nodes,0,0,100,100).map((tile) => {
          const area = tile.w * tile.h;
          const cls = area < 750 || tile.w < 25 || tile.h < 22 ? " compact" : "";
          const tiny = area < 250 || tile.w < 11 || tile.h < 12 ? " tiny" : "";
          const colors = healthColors[tile.health];
          const title = tile.label + " · " + tile.count + (language === "zh" ? " 个 · " : " · ") + healthLabel(tile.health);
          return '<button class="tile'+cls+tiny+'" data-consumer="'+esc(system.consumer)+'" data-type="'+esc(tile.id)+'" title="'+esc(title)+'" style="left:'+tile.x+'%;top:'+tile.y+'%;width:'+tile.w+'%;height:'+tile.h+'%;--tile:'+colors[0]+';--tile-dark:'+colors[1]+'"><span class="tileLabel">'+esc(tile.label)+'</span><span class="tileState">'+esc(healthLabel(tile.health))+'</span></button>';
        }).join("");
        return '<section class="systemGroup" style="flex-grow:'+Math.max(system.resourceSurfaceWeight/total,.08)+'"><button class="systemHead" data-consumer="'+esc(system.consumer)+'" style="--status:var(--'+system.health+')"><strong>'+esc(system.label)+'</strong><span></span></button><div class="systemTiles">'+tiles+'</div></section>';
      }).join("");
      mapBoard.querySelectorAll(".tile").forEach((button) => button.addEventListener("click", () => openDetail({ consumer:button.dataset.consumer, type:button.dataset.type })));
      mapBoard.querySelectorAll(".systemHead").forEach((button) => button.addEventListener("click", () => openDetail({ consumer:button.dataset.consumer })));
    }

    function renderIssues() {
      const diagnosticIssues = snapshot.issues;
      if (!diagnosticIssues.length) { issueList.innerHTML = '<div class="quiet">'+esc(t("emptyIssues"))+'</div>'; return; }
      issueList.innerHTML = diagnosticIssues.map((issue,index) => {
        const color = issue.severity === "warning" ? "var(--warning)" : issue.severity === "attention" ? "var(--attention)" : issue.severity === "healthy" ? "var(--healthy)" : "#4776a8";
        const title = language === "zh" ? issue.title : issue.titleEn;
        const detail = language === "zh" ? issue.detail : issue.detailEn;
        const action = language === "zh" ? issue.action : issue.actionEn;
        return '<button class="issue" data-index="'+index+'" style="--issue:'+color+'"><strong>'+esc(title)+'</strong><p>'+esc(detail)+'</p><p class="next">'+esc(t("next"))+': '+esc(action)+'</p></button>';
      }).join("");
      issueList.querySelectorAll(".issue").forEach((button) => button.addEventListener("click", () => {
        const issue = diagnosticIssues[Number(button.dataset.index)];
        openDetail({ ids:issue.assetIds, type:issue.type, titleZh:issue.title, titleEn:issue.titleEn });
      }));
    }

    function openDetail(filter) {
      detailFilter = filter;
      detailHealthFilter = "all";
      overview.style.display = "none";
      detailView.classList.add("open");
      detailSearch.value = "";
      renderDetail();
      window.scrollTo({ top:0, behavior:"smooth" });
    }

    function filteredResources(ignoreHealth) {
      const resourcePool = detailFilter?.type === "plugin" ? scopeSnapshots[0].resources : snapshot.resources;
      let items = detailFilter?.type === "plugin" ? resourcePool.filter((item) => item.type === "plugin") : resourcePool.filter((item) => item.effective);
      if (detailFilter.ids?.length) items = resourcePool.filter((item) => detailFilter.ids.includes(item.id));
      if (detailFilter.owner) items = items.filter((item) => item.owner === detailFilter.owner);
      if (detailFilter.consumer) items = items.filter((item) => item.consumer === detailFilter.consumer);
      if (detailFilter.type) items = items.filter((item) => item.type === detailFilter.type);
      if (!ignoreHealth && detailHealthFilter !== "all") items = items.filter((item) => item.health === detailHealthFilter);
      const query = detailSearch.value.trim().toLowerCase();
      if (query) items = items.filter((item) => (item.name+" "+item.path+" "+item.reason+" "+item.reasonEn+" "+JSON.stringify(item.states)).toLowerCase().includes(query));
      const rank = { warning:3, attention:2, healthy:1, inactive:0 };
      return items.sort((a,b) => rank[b.health] - rank[a.health] || a.name.localeCompare(b.name));
    }

    function renderDetail() {
      const allItems = filteredResources(true);
      const items = filteredResources(false);
      const issueTitle = language === "zh" ? detailFilter.titleZh : detailFilter.titleEn;
      const base = issueTitle || [detailFilter.consumer ? runtimeLabel(detailFilter.consumer) : detailFilter.owner ? ownerLabel(detailFilter.owner) : "", detailFilter.type ? typeLabel(detailFilter.type) : ""].filter(Boolean).join(" · ") || (language === "zh" ? "资源" : "Resources");
      document.getElementById("detailHeading").textContent = base;
      document.getElementById("detailSummary").textContent = language === "zh" ? items.length + " " + t("resourceSummary") : items.length + t("resourceSummary");
      const counts = { healthy:0, attention:0, warning:0, inactive:0 };
      allItems.forEach((item) => counts[item.health] += 1);
      const chips = document.getElementById("chips");
      const total = Object.values(counts).reduce((sum,count) => sum + count, 0);
      chips.innerHTML = '<button class="chip'+(detailHealthFilter === "all" ? ' active' : '')+'" data-health="all">'+esc(t("all"))+' '+total+'</button>' + Object.entries(counts).filter(([,count]) => count).map(([health,count]) => '<button class="chip'+(detailHealthFilter === health ? ' active' : '')+'" data-health="'+health+'">'+esc(healthLabel(health))+' '+count+'</button>').join("");
      chips.querySelectorAll("[data-health]").forEach((button) => button.addEventListener("click", () => { detailHealthFilter = button.dataset.health; renderDetail(); }));
      const list = document.getElementById("resourceList");
      if (!items.length) { list.innerHTML = '<div class="empty">'+esc(t("emptyResources"))+'</div>'; return; }
      const shown = items.slice(0,300);
      list.innerHTML = shown.map((item) => {
        const color = healthColors[item.health][0];
        const lifecycle = ['present','valid','enabled','loaded'].map((key) => key+'='+stateLabel(item.states?.[key]?.value)).join(' · ');
        const reason = (language === "zh" ? item.reason : item.reasonEn) || (language === "zh" ? "状态证据见四态；unknown 不等于 false。" : "Lifecycle states show the evidence; unknown is not false.");
        const source = ownerLabel(item.owner)+(item.consumer ? ' → '+runtimeLabel(item.consumer) : '');
        return '<article class="resourceRow"><div class="resourceName"><strong>'+esc(item.name)+'</strong><span>'+esc(typeLabel(item.type))+'</span></div><span class="badge" style="--badge:'+color+'"><i></i>'+esc(healthLabel(item.health))+'</span><div class="resourceSource">'+esc(source)+'<br><span class="resourcePath">'+esc(item.scope)+'</span></div><div class="resourceReason">'+esc(reason)+'<br>'+esc(t("lifecycle"))+': '+esc(lifecycle)+'<br>'+esc(t("confidence"))+': '+esc(confidenceLabels[language][item.confidence] || item.confidence)+'</div><div class="resourcePath">'+esc(item.path)+'</div></article>';
      }).join("") + (items.length > shown.length ? '<div class="empty">'+esc(items.length-shown.length)+' '+esc(t("omitted"))+'</div>' : '');
    }

    function stateLabel(value) { return value === "unknown" ? (language === "zh" ? "未知" : "unknown") : value ? (language === "zh" ? "是" : "true") : (language === "zh" ? "否" : "false"); }
    function runtimeLabel(runtime) { return ({codex:"Codex",claude:"Claude",hermes:"Hermes"})[runtime] || runtime; }
    function ownerLabel(owner) { return ({codex:"Codex storage",claude:"Claude storage",agents:"Shared Agents storage",hermes:"Hermes storage",project:"Project storage",unknown:"External / unknown storage"})[owner] || owner; }
    function esc(value) { return String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
    document.getElementById("back").addEventListener("click", () => { detailView.classList.remove("open"); overview.style.display = "grid"; detailFilter = null; });
    detailSearch.addEventListener("input", renderDetail);
    document.getElementById("scopeMode").addEventListener("change", applyScope);
    document.getElementById("projectSelect").addEventListener("change", applyScope);
    document.getElementById("showPlugins").addEventListener("click", () => openDetail({ type:"plugin", titleZh:"Plugin 生命周期", titleEn:"Plugin lifecycle" }));

    const aiModal = document.getElementById("aiModal");
    const aiContext = document.getElementById("aiContext");
    document.getElementById("showAiContext").addEventListener("click", () => {
      const index = currentScopeIndex();
      aiContext.textContent = scopeContexts[index]?.[language] || "";
      updateFullContextLink();
      aiModal.classList.add("open");
    });
    document.getElementById("closeAiContext").addEventListener("click", () => aiModal.classList.remove("open"));
    document.getElementById("copyAiContext").addEventListener("click", async (event) => {
      const text = aiContext.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      event.target.textContent = t("copied");
      setTimeout(() => { event.target.textContent = t("copyMarkdown"); }, 1200);
    });
    document.getElementById("langToggle").addEventListener("click", () => {
      language = language === "zh" ? "en" : "zh";
      applyLanguage();
      renderHeader();
      renderMap();
      renderIssues();
      if (detailView.classList.contains("open")) renderDetail();
      if (aiModal.classList.contains("open")) {
        const index = currentScopeIndex();
        aiContext.textContent = scopeContexts[index]?.[language] || "";
      }
      updateFullContextLink();
    });
    aiModal.addEventListener("click", (event) => { if (event.target === aiModal) aiModal.classList.remove("open"); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") aiModal.classList.remove("open"); });
    applyLanguage();
    applyScope();
  </script>
</body>
</html>`;
}
