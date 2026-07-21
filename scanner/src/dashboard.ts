import type { AtlasSnapshot } from "./diagnose.ts";
import { renderContextMarkdown } from "./diagnose.ts";
import { dashboardCss } from "./dashboard-style.ts";

interface ContextFiles {
  zh: string;
  en: string;
}

type CompactState = [value: boolean | "unknown", confidence: string, evidenceCount: number];

function compactAssessment(state: { value: boolean | "unknown"; confidence: string; evidenceIds: string[]; reason: string | null }): CompactState {
  return [state.value, state.confidence, state.evidenceIds.length];
}

function compactResource(resource: AtlasSnapshot["resources"][number]) {
  const keepReason = resource.health === "warning" || resource.health === "attention" || (!resource.effective && resource.bindingId);
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    owner: resource.owner,
    placementOwner: resource.placementOwner === resource.owner ? undefined : resource.placementOwner,
    scope: resource.scope === "global" ? undefined : resource.scope,
    path: resource.path,
    health: resource.health === "healthy" ? undefined : resource.health,
    effective: resource.effective ? true : undefined,
    consumer: resource.consumer,
    canonicalSourceId: resource.canonicalSourceId,
    installationId: resource.installationId,
    bindingId: resource.bindingId,
    diagnosisKinds: resource.diagnosisKinds.length ? resource.diagnosisKinds : undefined,
    states: {
      present: compactAssessment(resource.states.present),
      valid: compactAssessment(resource.states.valid),
      enabled: compactAssessment(resource.states.enabled),
      loaded: compactAssessment(resource.states.loaded)
    },
    identity: {
      isSymlink: resource.identity.isSymlink ? true : undefined,
      realpath: resource.identity.realpath === resource.path ? undefined : resource.identity.realpath,
      device: resource.identity.device,
      inode: resource.identity.inode,
      contentHash: resource.identity.contentHash
    },
    lineage: {
      canonical: resource.lineage.canonical ? {
        sourceType: resource.lineage.canonical.source ? resource.lineage.canonical.sourceType : undefined,
        source: resource.lineage.canonical.source,
        sourcePath: resource.lineage.canonical.sourcePath,
        confidence: resource.lineage.canonical.confidence
      } : null,
      installation: resource.lineage.installation ? {
        role: resource.lineage.installation.role,
        locationCount: resource.lineage.installation.locationCount === 1 ? undefined : resource.lineage.installation.locationCount
      } : null,
      binding: resource.lineage.binding ? {
        discovery: resource.lineage.binding.discovery,
        priority: resource.lineage.binding.priority === 100 ? undefined : resource.lineage.binding.priority,
        visibility: resource.lineage.binding.visibility === "visible" ? undefined : resource.lineage.binding.visibility
      } : null
    },
    reason: keepReason ? resource.reason : undefined,
    reasonEn: keepReason ? resource.reasonEn : undefined
  };
}

function compactSnapshot(
  snapshot: AtlasSnapshot,
  includeInventory: boolean,
  includePlugins: boolean,
  baseResources?: Map<string, ReturnType<typeof compactResource>>
) {
  const issues = snapshot.issues.map((issue) => issue.id === "plugin-lifecycle" ? { ...issue, assetIds: [] } : issue);
  const issueAssetIds = new Set(issues.flatMap((issue) => issue.assetIds));
  const compactedResources = snapshot.resources
    .filter((resource) => resource.type !== "plugin" && (includeInventory || resource.effective || issueAssetIds.has(resource.id)))
    .map(compactResource);
  const resourceIds = baseResources ? compactedResources.map((resource) => resource.id) : undefined;
  const resources = baseResources
    ? compactedResources.filter((resource) => JSON.stringify(baseResources.get(resource.id)) !== JSON.stringify(resource))
    : compactedResources;
  const plugins = includePlugins ? snapshot.plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    kind: plugin.kind,
    storageOwner: plugin.storageOwner,
    manifestPath: plugin.manifestPath,
    bundled: compactAssessment(plugin.bundled),
    installed: compactAssessment(plugin.installed),
    enabled: compactAssessment(plugin.enabled),
    loaded: compactAssessment(plugin.loaded)
  })) : [];
  const diagnoses = snapshot.diagnoses.map((diagnosis) => ({
    id: diagnosis.id,
    kind: diagnosis.kind,
    severity: diagnosis.severity,
    confidence: diagnosis.confidence,
    consumerId: diagnosis.consumerId,
    canonicalSourceIds: diagnosis.canonicalSourceIds,
    installationIds: diagnosis.installationIds,
    bindingIds: diagnosis.bindingIds,
    evidenceIds: diagnosis.evidenceIds
  }));
  return { ...snapshot, resources, resourceIds, issues, diagnoses, plugins };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

const copy = {
  zh: {
    productLabel: "AI 资源诊断与证据控制台", lastScan: "最后扫描", aiContext: "给 AI 的上下文",
    evidenceBoundVerdict: "证据约束结论", readOnly: "只读诊断，不执行清理", confirmedStructuralRisk: "已确认结构风险",
    loadedEvidence: "Loaded 证据", navDiagnosis: "诊断", navRelations: "关系", navPlugins: "Plugin", navResources: "资源审计",
    queueTitle: "诊断与证据队列", queueHelp: "风险、扫描警告和运行证据缺口分开呈现。", runtimeMatrix: "Runtime 状态矩阵",
    runtimeHelp: "Visible 不等于 enabled 或 loaded；? 表示没有证据。", inspectResources: "审计资源 →", surfaceDistribution: "资源面分布",
    distributionHelp: "仅表达当前 runtime-visible 规模，不表示影响力。", relationFacts: "关系事实",
    relationHelp: "按 alias、mirror、redundant、conflict 聚合，不重复制造告警。", lineageTitle: "来源与运行链",
    lineageHelp: "canonical source → installation/location → binding/consumer", pluginLifecycle: "Plugin 生命周期",
    pluginHelp: "四个状态相互独立；bundled 或 marketplace 不等于 installed。", pluginNote: "Unknown 是证据状态，不会被折算为 false。",
    resourceExplorer: "资源证据浏览器", resourceHelp: "展开资源查看 canonical、installation、binding、realpath、hash 与四态。",
    aiModalTitle: "给 AI 的当前上下文", fullContext: "完整上下文", copyMarkdown: "复制 Markdown", close: "关闭",
    scopeProject: "当前项目", scopeGlobal: "本机全局", all: "全部", visible: "可见", enabled: "Enabled", loaded: "Loaded",
    unknown: "未知", structuralIntegrity: "结构完整性", runtimeEvidence: "运行证据", scanCoverage: "扫描事实", actions: "结构待处理",
    noConfirmedConflict: "未发现已确认的结构冲突", structuralRiskFound: "发现已确认的结构风险", evidenceIncomplete: "运行证据不完整",
    evidenceAvailable: "已有运行证据", structuralClear: "当前关系规则未产生 conflict 或 redundant。", conflict: "冲突",
    redundant: "冗余加载", mirror: "镜像", alias: "别名", invalid: "无效", uncertain: "不确定", info: "信息",
    healthy: "结构正常", attention: "待确认", warning: "警告", inactive: "不可见", present: "Present", valid: "Valid",
    installations: "安装", bindings: "绑定", machineInventory: "本机安装口径", evidenceGap: "运行证据缺口",
    evidenceGapDetail: "资源已进入 runtime-visible 面，但 enabled/loaded 缺少直接证据。",
    evidenceGapAction: "接入运行时配置或 session 证据后再判断实际使用。", next: "建议",
    noActionable: "没有已确认的待处理结构问题", relationsRemain: "健康 alias 与信息级 mirror 保留在关系视图中。",
    visibleReason: "资源进入当前 runtime-visible 面；enabled 与 loaded 仍需独立证据。", inventoryReason: "仅在库存中发现；当前范围没有 runtime binding 证据。",
    runtime: "Runtime", structural: "结构", direct: "直接", inherited: "继承", inventoryOnly: "非 Plugin 库存", viewInventory: "查看库存",
    chooseRelation: "选择一个关系事实，查看可追溯链。", canonical: "Canonical source", installation: "Installation / location",
    bindingConsumer: "Binding / consumer", evidence: "证据", locations: "路径", hash: "Hash", symlink: "Symlink", realpath: "Realpath",
    storage: "存储归属", consumer: "Consumer", priority: "优先级", discovery: "发现方式", visibility: "可见性",
    packages: "Packages", bundled: "Bundled", installed: "Installed", stateFilter: "状态筛选", kindFilter: "类型筛选",
    searchPlugins: "搜索 package、manifest 或 owner", searchResources: "搜索名称、路径、hash、来源或状态",
    allRuntimes: "全部 runtime", allTypes: "全部类型", allResources: "全部资源", visibleOnly: "仅 runtime-visible",
    inventoryMode: "仅库存/不可见", unknownMode: "enabled/loaded 未知", diagnosticMode: "有诊断关系", matching: "项匹配",
    omitted: "项未显示", noMatch: "没有匹配结果", confidence: "置信度", facts: "身份事实", ids: "图引用",
    placement: "路径归属", scope: "范围", copied: "已复制"
  },
  en: {
    productLabel: "AI resource diagnosis and evidence console", lastScan: "Last scan", aiContext: "AI context",
    evidenceBoundVerdict: "Evidence-bounded verdict", readOnly: "Read-only diagnosis; no cleanup actions", confirmedStructuralRisk: "Confirmed structural risk",
    loadedEvidence: "Loaded evidence", navDiagnosis: "Diagnosis", navRelations: "Relations", navPlugins: "Plugins", navResources: "Resource audit",
    queueTitle: "Diagnosis and evidence queue", queueHelp: "Risks, scan warnings, and runtime evidence gaps remain separate.", runtimeMatrix: "Runtime state matrix",
    runtimeHelp: "Visible is not enabled or loaded; ? means evidence is absent.", inspectResources: "Audit resources →", surfaceDistribution: "Resource-surface distribution",
    distributionHelp: "Shows runtime-visible scale only, never influence.", relationFacts: "Relationship facts",
    relationHelp: "Alias, mirror, redundant, and conflict are grouped without duplicate alarms.", lineageTitle: "Provenance and runtime chain",
    lineageHelp: "canonical source → installation/location → binding/consumer", pluginLifecycle: "Plugin lifecycle",
    pluginHelp: "The four states are independent; bundled or marketplace does not mean installed.", pluginNote: "Unknown is an evidence state and is never coerced to false.",
    resourceExplorer: "Resource evidence explorer", resourceHelp: "Expand a resource to inspect canonical, installation, binding, realpath, hash, and four states.",
    aiModalTitle: "Current context for AI", fullContext: "Full context", copyMarkdown: "Copy Markdown", close: "Close",
    scopeProject: "Current project", scopeGlobal: "Global machine", all: "All", visible: "Visible", enabled: "Enabled", loaded: "Loaded",
    unknown: "Unknown", structuralIntegrity: "Structural integrity", runtimeEvidence: "Runtime evidence", scanCoverage: "Scan facts", actions: "Structural actions",
    noConfirmedConflict: "No confirmed structural conflict", structuralRiskFound: "Confirmed structural risk found", evidenceIncomplete: "Runtime evidence incomplete",
    evidenceAvailable: "Runtime evidence available", structuralClear: "Current relationship rules produced no conflict or redundant diagnosis.", conflict: "Conflict",
    redundant: "Redundant load", mirror: "Mirror", alias: "Alias", invalid: "Invalid", uncertain: "Uncertain", info: "Info",
    healthy: "Structurally clear", attention: "Review", warning: "Warning", inactive: "Not visible", present: "Present", valid: "Valid",
    installations: "Installations", bindings: "Bindings", machineInventory: "Machine installation denominator", evidenceGap: "Runtime evidence gap",
    evidenceGapDetail: "Resources are runtime-visible, but direct enabled/loaded evidence is absent.",
    evidenceGapAction: "Add runtime configuration or session evidence before claiming actual use.", next: "Next",
    noActionable: "No confirmed actionable structural issue", relationsRemain: "Healthy aliases and informational mirrors remain in the Relations view.",
    visibleReason: "The resource is on the current runtime-visible surface; enabled and loaded still require independent evidence.", inventoryReason: "Discovered as inventory only; no runtime binding applies to the current scope.",
    runtime: "Runtime", structural: "Structure", direct: "Direct", inherited: "Inherited", inventoryOnly: "Non-plugin inventory", viewInventory: "View inventory",
    chooseRelation: "Choose a relationship fact to inspect its traceable chain.", canonical: "Canonical source", installation: "Installation / location",
    bindingConsumer: "Binding / consumer", evidence: "Evidence", locations: "Locations", hash: "Hash", symlink: "Symlink", realpath: "Realpath",
    storage: "Storage owner", consumer: "Consumer", priority: "Priority", discovery: "Discovery", visibility: "Visibility",
    packages: "Packages", bundled: "Bundled", installed: "Installed", stateFilter: "State filter", kindFilter: "Kind filter",
    searchPlugins: "Search package, manifest, or owner", searchResources: "Search name, path, hash, provenance, or state",
    allRuntimes: "All runtimes", allTypes: "All types", allResources: "All resources", visibleOnly: "Runtime-visible only",
    inventoryMode: "Inventory / not visible", unknownMode: "Enabled/loaded unknown", diagnosticMode: "Has diagnosis relation", matching: "matching",
    omitted: "items omitted", noMatch: "No matching result", confidence: "Confidence", facts: "Identity facts", ids: "Graph references",
    placement: "Path placement", scope: "Scope", copied: "Copied"
  }
} as const;

export function renderDashboardHtml(snapshot: AtlasSnapshot, scopeSnapshots: AtlasSnapshot[], fullContextFiles: ContextFiles[]): string {
  const globalScope = compactSnapshot(scopeSnapshots[0]!, true, true);
  const baseResources = new Map(globalScope.resources.map((resource) => [resource.id, resource]));
  const scopePayloads = [
    globalScope,
    ...scopeSnapshots.slice(1).map((scope) => compactSnapshot(scope, true, false, baseResources))
  ];
  const scopesData = JSON.stringify(scopePayloads).replace(/</g, "\\u003c");
  const contextsData = JSON.stringify(scopeSnapshots.map((scope, index) => ({
    zh: renderContextMarkdown(scope, "zh", { fullContextPath: `data/${fullContextFiles[index]!.zh}` }),
    en: renderContextMarkdown(scope, "en", { fullContextPath: `data/${fullContextFiles[index]!.en}` })
  }))).replace(/</g, "\\u003c");
  const fullContextsData = JSON.stringify(fullContextFiles).replace(/</g, "\\u003c");
  const copyData = JSON.stringify(copy).replace(/</g, "\\u003c");
  const generated = snapshot.generatedAt.slice(0, 16).replace("T", " ");
  const projectLabel = snapshot.project?.name ?? "本机全局环境";
  const projectOptions = scopeSnapshots.slice(1).map((scope, index) => `<option value="${index + 1}">${escapeHtml(scope.project?.name ?? "Project")}</option>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Atlas · ${escapeHtml(projectLabel)}</title>
  <style>${dashboardCss}</style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div class="brand"><div class="mark">A</div><div><h1>Agent Atlas</h1><div class="productLabel" data-i18n="productLabel"></div></div><div class="scopeControls"><select id="scopeMode" class="scopeSelect" aria-label="Scope"><option value="global">本机全局</option><option value="project">项目</option></select><select id="projectSelect" class="scopeSelect" aria-label="Project" hidden>${projectOptions}</select></div></div>
      <div class="topActions"><span class="scanMeta"><span data-i18n="lastScan"></span> ${escapeHtml(generated)}</span><button id="showAiContext" class="topButton primary" data-i18n="aiContext"></button><button id="langToggle" class="topButton">中 / EN</button></div>
    </header>

    <section class="hero">
      <div><div class="eyebrow"><i></i><span data-i18n="evidenceBoundVerdict"></span></div><h2 id="verdictTitle"></h2><p id="verdictDetail"></p><div class="heroBadges"><span class="heroBadge"><i id="structureDot"></i><span id="structureBadge"></span></span><span class="heroBadge"><i id="evidenceDot"></i><span id="evidenceBadge"></span></span><span class="heroBadge"><i style="--badge:#8da2ff"></i><span data-i18n="readOnly"></span></span></div></div>
      <div class="heroSignals"><div class="heroSignal"><span data-i18n="confirmedStructuralRisk"></span><strong id="heroRisk"></strong><small id="heroRiskDetail"></small></div><div class="heroSignal"><span data-i18n="loadedEvidence"></span><strong id="heroLoaded"></strong><small id="heroLoadedDetail"></small></div></div>
    </section>

    <nav class="workspaceNav" aria-label="Workspace views"><button class="navButton active" data-view="overview"><span data-i18n="navDiagnosis"></span><span id="navActionCount"></span></button><button class="navButton" data-view="relations"><span data-i18n="navRelations"></span><span id="navRelationCount"></span></button><button class="navButton" data-view="plugins"><span data-i18n="navPlugins"></span><span id="navPluginCount"></span></button><button class="navButton" data-view="resources"><span data-i18n="navResources"></span><span id="navResourceCount"></span></button></nav>

    <section id="view-overview" class="view active">
      <div id="evidenceGrid" class="evidenceGrid"></div>
      <div class="primaryGrid">
        <article class="panel"><header class="panelHead"><div><h3 data-i18n="queueTitle"></h3><p data-i18n="queueHelp"></p></div></header><div id="queueList" class="queueList"></div></article>
        <article class="panel"><header class="panelHead"><div><h3 data-i18n="runtimeMatrix"></h3><p data-i18n="runtimeHelp"></p></div><button class="textButton" data-open-resources="all" data-i18n="inspectResources"></button></header><div id="runtimeTable" class="runtimeTable"></div></article>
      </div>
      <article class="panel distribution"><header class="panelHead"><div><h3 data-i18n="surfaceDistribution"></h3><p data-i18n="distributionHelp"></p></div></header><div id="distributionBody" class="distributionBody"></div></article>
    </section>

    <section id="view-relations" class="view"><div id="relationSummary" class="summaryGrid"></div><div class="relationLayout"><article class="panel"><header class="panelHead"><div><h3 data-i18n="relationFacts"></h3><p data-i18n="relationHelp"></p></div></header><div id="relationFilters" class="filterBar"></div><div id="relationList" class="relationList"></div></article><article class="panel tracePanel"><header class="panelHead"><div><h3 data-i18n="lineageTitle"></h3><p data-i18n="lineageHelp"></p></div></header><div id="relationTrace" class="traceBody"></div></article></div></section>

    <section id="view-plugins" class="view"><div id="pluginKpis" class="pluginKpis"></div><article class="panel"><header class="panelHead"><div><h3 data-i18n="pluginLifecycle"></h3><p data-i18n="pluginHelp"></p></div></header><div class="controls"><input id="pluginSearch" class="search" type="search"><select id="pluginKind" class="select"></select><select id="pluginState" class="select"></select><span id="pluginResultCount" class="resultCount"></span></div><div id="pluginList" class="pluginList"></div><div class="sectionNote" data-i18n="pluginNote"></div></article></section>

    <section id="view-resources" class="view"><article class="panel"><header class="panelHead"><div><h3 data-i18n="resourceExplorer"></h3><p data-i18n="resourceHelp"></p></div></header><div class="controls"><input id="resourceSearch" class="search" type="search"><select id="resourceRuntime" class="select"></select><select id="resourceType" class="select"></select><select id="resourceMode" class="select"></select><span id="resourceResultCount" class="resultCount"></span></div><div id="resourceList" class="resourceList"></div></article></section>

    <section id="aiModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="aiModalTitle"><div class="modalCard"><header class="modalHead"><h3 id="aiModalTitle" data-i18n="aiModalTitle"></h3><div class="modalActions"><a id="fullContextLink" class="fullContextLink" href="atlas-context-full.zh.md" data-i18n="fullContext"></a><button id="copyAiContext" class="primary" data-i18n="copyMarkdown"></button><button id="closeAiContext" data-i18n="close"></button></div></header><pre id="aiContext" class="aiContext"></pre></div></section>
  </main>

  <script>
    const scopeSnapshots = ${scopesData};
    const baseResourceMap = new Map(scopeSnapshots[0].resources.map((resource) => [resource.id,resource]));
    scopeSnapshots.slice(1).forEach((scope) => { const overrides=new Map(scope.resources.map((resource) => [resource.id,resource])); scope.resources=(scope.resourceIds||[]).map((id) => overrides.get(id)||baseResourceMap.get(id)).filter(Boolean); });
    const scopeContexts = ${contextsData};
    const fullContextFiles = ${fullContextsData};
    const translations = ${copyData};
    let snapshot = scopeSnapshots[0];
    let activeView = "overview";
    let relationFilter = "all";
    let selectedRelationId = null;
    let resourceFilter = { ids:null, consumer:"all", type:"all", mode:"all" };
    let language = "zh";
    const globalPlugins = scopeSnapshots[0].plugins || [];
    const typeLabelsByLang = { zh:{skill:"技能",memory:"记忆",mcp:"MCP",agent:"Agent",config:"配置",project:"项目",session:"会话",plugin:"Plugin"}, en:{skill:"Skills",memory:"Memory",mcp:"MCP",agent:"Agents",config:"Config",project:"Project",session:"Sessions",plugin:"Plugin"} };
    const healthLabelsByLang = { zh:{healthy:"结构正常",attention:"需要确认",warning:"存在冲突",inactive:"不可见"}, en:{healthy:"Structurally clear",attention:"Needs review",warning:"Conflict",inactive:"Not visible"} };
    const confidenceLabels = { zh:{confirmed:"已确认",inferred:"推定",unknown:"未知"}, en:{confirmed:"Confirmed",inferred:"Inferred",unknown:"Unknown"} };

    function t(key) { return translations[language][key] || key; }
    function esc(value) { return String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
    function typeLabel(type) { return typeLabelsByLang[language][type] || type; }
    function healthLabel(health) { return healthLabelsByLang[language][health] || health; }
    function shortId(value) { if (!value) return "—"; const text=String(value); const split=text.indexOf(":"); return split>=0 ? text.slice(0,split+1)+text.slice(split+1,split+9) : text.slice(0,12); }
    function shortHash(value) { return value ? String(value).slice(0,12) : "—"; }
    function runtimeLabel(runtime) { return ({codex:"Codex",claude:"Claude",hermes:"Hermes"})[runtime] || runtime || "—"; }
    function ownerLabel(owner) { const labels=language==="zh"?{codex:"Codex 存储",claude:"Claude 存储",agents:"共享 Agents 存储",hermes:"Hermes 存储",project:"项目存储",unknown:"外部 / 未知存储"}:{codex:"Codex storage",claude:"Claude storage",agents:"Shared Agents storage",hermes:"Hermes storage",project:"Project storage",unknown:"External / unknown storage"}; return labels[owner] || owner || "—"; }
    function stateValue(state) { return Array.isArray(state) ? state[0] : state?.value ?? "unknown"; }
    function stateConfidence(state) { return Array.isArray(state) ? state[1] : state?.confidence || "unknown"; }
    function stateEvidenceCount(state) { return Array.isArray(state) ? state[2] : state?.evidenceCount || 0; }
    function stateLabel(value) { return value==="unknown" ? "?" : value ? (language==="zh"?"是":"Yes") : (language==="zh"?"否":"No"); }
    function stateTone(value) { return value===true?["var(--healthy)","var(--healthy-soft)"]:value===false?["var(--warning)","var(--warning-soft)"]:["var(--attention)","var(--attention-soft)"]; }
    function healthTone(health) { return health==="warning"?["var(--warning)","var(--warning-soft)"]:health==="attention"?["var(--attention)","var(--attention-soft)"]:health==="healthy"?["var(--healthy)","var(--healthy-soft)"]:["var(--inactive)","#f0f2f5"]; }
    function issueKindLabel(kind) { return t(kind || "info"); }
    function relationIssues() { return snapshot.issues.filter((issue) => ["alias","mirror","redundant","conflict","uncertain","invalid"].includes(issue.kind)); }
    function actionableIssues() { return snapshot.issues.filter((issue) => issue.severity==="warning" || issue.severity==="attention"); }
    function visibleResources() { return snapshot.resources.filter((resource) => resource.effective); }
    function countVisibleState(key,value) { return visibleResources().filter((resource) => stateValue(resource.states?.[key])===value).length; }
    function countRelations(kind) { return relationIssues().filter((issue) => issue.kind===kind).length; }
    function stateCell(label,state) { const value=stateValue(state), tone=stateTone(value); return '<span class="stateCell" title="'+esc(label)+' · '+esc(stateConfidence(state))+' · '+esc(stateEvidenceCount(state))+' evidence" style="--tone:'+tone[0]+';--soft:'+tone[1]+'"><i></i>'+esc(label)+' '+esc(stateLabel(value))+'</span>'; }
    function healthBadge(health) { const tone=healthTone(health); return '<span class="badge" style="--tone:'+tone[0]+';--soft:'+tone[1]+'"><i></i>'+esc(healthLabel(health))+'</span>'; }

    function currentScopeIndex() { return document.getElementById("scopeMode").value==="project" ? Number(document.getElementById("projectSelect").value||1) : 0; }
    function updateFullContextLink() { document.getElementById("fullContextLink").href=fullContextFiles[currentScopeIndex()]?.[language] || fullContextFiles[0][language]; }
    function applyLanguage() {
      document.documentElement.lang=language==="zh"?"zh-CN":"en";
      document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent=t(element.dataset.i18n); });
      const scopeMode=document.getElementById("scopeMode"); const selectedMode=scopeMode.value||"global";
      scopeMode.innerHTML='<option value="global">'+esc(t("scopeGlobal"))+'</option><option value="project"'+(scopeSnapshots.length<2?' disabled':'')+'>'+esc(t("scopeProject"))+'</option>'; scopeMode.value=selectedMode;
      const projectSelect=document.getElementById("projectSelect"); const selectedProject=projectSelect.value||"1";
      projectSelect.innerHTML=scopeSnapshots.slice(1).map((scope,index) => '<option value="'+(index+1)+'">'+esc(scope.project?.name||"Project")+'</option>').join(""); if(scopeSnapshots.length>1) projectSelect.value=selectedProject;
      document.getElementById("pluginSearch").placeholder=t("searchPlugins"); document.getElementById("resourceSearch").placeholder=t("searchResources");
    }
    function applyScope() { const projectMode=document.getElementById("scopeMode").value==="project"; document.getElementById("projectSelect").hidden=!projectMode; snapshot=scopeSnapshots[currentScopeIndex()]||scopeSnapshots[0]; relationFilter="all"; selectedRelationId=null; resourceFilter={ids:null,consumer:"all",type:"all",mode:"all"}; updateFullContextLink(); renderAll(); }
    function setView(view,scroll) { activeView=view; document.querySelectorAll(".view").forEach((element) => element.classList.toggle("active",element.id==="view-"+view)); document.querySelectorAll(".navButton").forEach((button) => button.classList.toggle("active",button.dataset.view===view)); if(scroll!==false) document.querySelector(".workspaceNav").scrollIntoView({behavior:"smooth",block:"start"}); }

    function renderHero() {
      const conflict=countRelations("conflict"), redundant=countRelations("redundant"), invalid=countRelations("invalid");
      const structuralRisk=conflict+redundant+invalid, visible=visibleResources().length, enabled=countVisibleState("enabled",true), loaded=countVisibleState("loaded",true), enabledUnknown=countVisibleState("enabled","unknown"), loadedUnknown=countVisibleState("loaded","unknown");
      const scopePrefix=snapshot.project?(language==="zh"?'项目“'+snapshot.project.name+'”：':snapshot.project.name+': '):'';
      document.getElementById("verdictTitle").textContent=scopePrefix+t(structuralRisk?"structuralRiskFound":"noConfirmedConflict");
      document.getElementById("verdictDetail").textContent=language==="zh"?visible+' 个 runtime-visible binding；enabled 已确认 '+enabled+'，loaded 已确认 '+loaded+'。未知状态不等于禁用。':visible+' runtime-visible bindings; enabled confirmed '+enabled+', loaded confirmed '+loaded+'. Unknown does not mean disabled.';
      document.getElementById("structureBadge").textContent=structuralRisk?t("structuralRiskFound"):t("structuralClear"); document.getElementById("structureDot").style.setProperty("--badge",structuralRisk?"var(--warning)":"var(--healthy)");
      document.getElementById("evidenceBadge").textContent=(enabledUnknown||loadedUnknown)?t("evidenceIncomplete"):t("evidenceAvailable"); document.getElementById("evidenceDot").style.setProperty("--badge",(enabledUnknown||loadedUnknown)?"var(--attention)":"var(--healthy)");
      document.getElementById("heroRisk").textContent=structuralRisk; document.getElementById("heroRiskDetail").textContent=t("conflict")+' '+conflict+' · '+t("redundant")+' '+redundant+' · '+t("invalid")+' '+invalid;
      document.getElementById("heroLoaded").textContent=loaded+' / '+visible; document.getElementById("heroLoadedDetail").textContent='enabled '+enabled+' / '+visible+' · ? '+loadedUnknown;
    }
    function renderNavigation() { const hasEvidenceGap=countVisibleState("enabled","unknown")>0||countVisibleState("loaded","unknown")>0; document.getElementById("navActionCount").textContent=actionableIssues().length+Number(hasEvidenceGap); document.getElementById("navRelationCount").textContent=relationIssues().length; document.getElementById("navPluginCount").textContent=globalPlugins.length; document.getElementById("navResourceCount").textContent=snapshot.resources.length; }
    function renderEvidenceCards() {
      const ledger=snapshot.evidenceLedger, visible=visibleResources().length, enabled=countVisibleState("enabled",true), loaded=countVisibleState("loaded",true), enabledUnknown=countVisibleState("enabled","unknown"), loadedUnknown=countVisibleState("loaded","unknown");
      const structuralRisk=countRelations("conflict")+countRelations("redundant")+countRelations("invalid"), actionable=actionableIssues().length;
      const cards=[
        {label:t("structuralIntegrity"),value:structuralRisk,foot:t("conflict")+' '+countRelations("conflict")+' · '+t("redundant")+' '+countRelations("redundant"),tone:structuralRisk?'var(--warning)':'var(--healthy)',view:"relations"},
        {label:t("runtimeEvidence"),value:loaded+' / '+visible,foot:'enabled '+enabled+' / '+visible+' · ? '+Math.max(enabledUnknown,loadedUnknown),tone:(enabledUnknown||loadedUnknown)?'var(--attention)':'var(--healthy)',view:"resources",mode:"unknown"},
        {label:t("scanCoverage"),value:ledger.installations.valid.true+' / '+ledger.installations.total,foot:t("present")+' '+ledger.installations.present.true+' · ? '+ledger.installations.valid.unknown+' · '+t("machineInventory"),tone:ledger.installations.valid.false?'var(--warning)':'var(--blue)',view:"resources",mode:"all"},
        {label:t("actions"),value:actionable,foot:actionable?(language==="zh"?'按严重度进入诊断队列':'Open the queue by severity'):t("noActionable"),tone:actionable?'var(--warning)':'var(--blue)',view:"overview"}
      ];
      document.getElementById("evidenceGrid").innerHTML=cards.map((card,index) => '<button class="evidenceCard" data-card="'+index+'" style="--tone:'+card.tone+'"><span class="label">'+esc(card.label)+'</span><strong>'+esc(card.value)+'</strong><p>'+esc(card.foot)+'</p></button>').join("");
      document.querySelectorAll("[data-card]").forEach((button) => button.addEventListener("click",() => { const card=cards[Number(button.dataset.card)]; if(card.view==="resources") openResources({mode:card.mode}); else setView(card.view); }));
    }
    function renderQueue() {
      const list=document.getElementById("queueList"), items=actionableIssues(), enabledUnknown=countVisibleState("enabled","unknown"), loadedUnknown=countVisibleState("loaded","unknown");
      let html=items.map((issue,index) => { const tone=issue.severity==="warning"?["var(--warning)","var(--warning-soft)"]:["var(--attention)","var(--attention-soft)"]; const title=language==="zh"?issue.title:issue.titleEn, detail=language==="zh"?issue.detail:issue.detailEn; return '<button class="queueItem" data-queue="'+index+'" style="--tone:'+tone[0]+';--soft:'+tone[1]+'"><span class="queueIcon">!</span><span><strong>'+esc(title)+'</strong><p>'+esc(detail)+'</p></span><span class="queueMeta">'+esc(issueKindLabel(issue.kind))+'</span></button>'; }).join("");
      if(enabledUnknown||loadedUnknown) html+='<button class="queueItem" data-gap="true" style="--tone:var(--attention);--soft:var(--attention-soft)"><span class="queueIcon">?</span><span><strong>'+esc(t("evidenceGap"))+'</strong><p>'+esc(t("evidenceGapDetail"))+' '+esc(t("next"))+': '+esc(t("evidenceGapAction"))+'</p></span><span class="queueMeta">'+esc(Math.max(enabledUnknown,loadedUnknown))+' ?</span></button>';
      if(!items.length) html+='<div class="zeroState"><strong>'+esc(t("noActionable"))+'</strong>'+esc(t("relationsRemain"))+'</div>'; list.innerHTML=html;
      list.querySelectorAll("[data-queue]").forEach((button) => button.addEventListener("click",() => openResources({ids:items[Number(button.dataset.queue)].assetIds,mode:"diagnostic"}))); list.querySelector("[data-gap]")?.addEventListener("click",() => openResources({mode:"unknown"}));
    }
    function renderRuntimeMatrix() {
      const root=document.getElementById("runtimeTable"), header='<div class="runtimeHeader"><span>'+esc(t("runtime"))+'</span><span>'+esc(t("visible"))+'</span><span>'+esc(t("enabled"))+'</span><span>'+esc(t("loaded"))+'</span><span>'+esc(t("structural"))+'</span></div>';
      const rows=snapshot.systems.map((system) => { const risk=system.diagnoses.warning+system.diagnoses.attention, tone=risk?["var(--warning)","var(--warning-soft)"]:system.bindings.total?["var(--healthy)","var(--healthy-soft)"]:["var(--inactive)","#f0f2f5"], scopeLine=snapshot.project?t("direct")+' '+system.direct+' · '+t("inherited")+' '+system.inherited:t("bindings")+' '+system.bindings.total; return '<button class="runtimeRow" data-runtime="'+esc(system.consumer)+'"><span class="runtimeName"><strong>'+esc(system.label)+'</strong><span>'+esc(scopeLine)+'</span></span><span class="runtimeMetric"><strong>'+esc(system.bindings.visible)+'</strong><span>'+esc(t("visible"))+'</span></span><span class="runtimeMetric"><strong>'+esc(system.states.enabled.true)+' / ?'+esc(system.states.enabled.unknown)+'</strong><span>'+esc(t("enabled"))+'</span></span><span class="runtimeMetric"><strong>'+esc(system.states.loaded.true)+' / ?'+esc(system.states.loaded.unknown)+'</strong><span>'+esc(t("loaded"))+'</span></span><span class="runtimeStatus" style="--tone:'+tone[0]+';--soft:'+tone[1]+'"><i></i>'+esc(risk?t("attention"):(system.bindings.total?t("healthy"):t("inactive")))+'</span></button>'; }).join("");
      root.innerHTML=header+(rows||'<div class="empty">'+esc(t("noMatch"))+'</div>'); root.querySelectorAll("[data-runtime]").forEach((button) => button.addEventListener("click",() => openResources({consumer:button.dataset.runtime,mode:"all"})));
    }
    function renderDistribution() {
      const max=Math.max(1,...snapshot.systems.map((system) => system.resources)); const bars=snapshot.systems.map((system) => '<div class="barRow"><button data-bar-runtime="'+esc(system.consumer)+'">'+esc(system.label)+'</button><div class="barTrack"><div class="barFill" style="--width:'+Math.max(2,system.resources/max*100)+'%"></div></div><span class="barValue">'+esc(system.resources)+'</span></div>').join("");
      const inventoryCount=snapshot.resources.filter((resource) => !resource.effective).length;
      document.getElementById("distributionBody").innerHTML='<div class="barList">'+bars+'</div><aside class="inventoryAside"><span>'+esc(t("inventoryOnly"))+'</span><strong>'+esc(inventoryCount)+'</strong><button class="textButton" id="viewInventory">'+esc(t("viewInventory"))+' →</button></aside>';
      document.querySelectorAll("[data-bar-runtime]").forEach((button) => button.addEventListener("click",() => openResources({consumer:button.dataset.barRuntime,mode:"visible"}))); document.getElementById("viewInventory").addEventListener("click",() => openResources({mode:"inventory"}));
    }
    function renderRelationSummary() {
      const kinds=["conflict","redundant","mirror","alias"];
      document.getElementById("relationSummary").innerHTML=kinds.map((kind) => '<button class="summaryCard'+(relationFilter===kind?' active':'')+'" data-relation-summary="'+kind+'"><span>'+esc(issueKindLabel(kind))+'</span><strong>'+countRelations(kind)+'</strong><small>'+esc(kind==="conflict"?(language==="zh"?"内容分叉且同一运行时可见":"Divergent content visible to one runtime"):kind==="redundant"?(language==="zh"?"同一运行时确认重复 loaded":"Duplicate loaded bindings in one runtime"):kind==="mirror"?(language==="zh"?"同内容、不同运行时":"Same content across runtimes"):(language==="zh"?"同一物理资源的多路径":"Multiple paths to one physical resource"))+'</small></button>').join("");
      document.querySelectorAll("[data-relation-summary]").forEach((button) => button.addEventListener("click",() => { relationFilter=button.dataset.relationSummary; selectedRelationId=null; renderRelations(); }));
    }
    function renderRelations() {
      renderRelationSummary(); const kinds=["all","conflict","redundant","mirror","alias","uncertain","invalid"];
      document.getElementById("relationFilters").innerHTML=kinds.map((kind) => '<button class="chip'+(relationFilter===kind?' active':'')+'" data-relation-filter="'+kind+'">'+esc(kind==="all"?t("all"):issueKindLabel(kind))+' '+(kind==="all"?relationIssues().length:countRelations(kind))+'</button>').join("");
      document.querySelectorAll("[data-relation-filter]").forEach((button) => button.addEventListener("click",() => { relationFilter=button.dataset.relationFilter; selectedRelationId=null; renderRelations(); }));
      const filtered=relationIssues().filter((issue) => relationFilter==="all"||issue.kind===relationFilter), list=document.getElementById("relationList");
      list.innerHTML=filtered.length?filtered.map((issue,index) => { const tone=issue.severity==="warning"?["var(--warning)","var(--warning-soft)"]:issue.severity==="attention"?["var(--attention)","var(--attention-soft)"]:issue.severity==="healthy"?["var(--healthy)","var(--healthy-soft)"]:["var(--blue)","var(--blue-soft)"], title=language==="zh"?issue.title:issue.titleEn; return '<button class="relationItem'+(selectedRelationId===issue.id?' active':'')+'" data-relation-index="'+index+'"><span class="relationTop"><strong>'+esc(title)+'</strong><span class="kindBadge" style="--tone:'+tone[0]+';--soft:'+tone[1]+'">'+esc(issueKindLabel(issue.kind))+'</span></span><p>'+esc(issue.assetIds.length)+' '+esc(t("locations"))+' · '+esc(issue.evidenceCount||0)+' '+esc(t("evidence"))+' · '+esc(confidenceLabels[language][issue.confidence]||issue.confidence||"unknown")+'</p></button>'; }).join(""):'<div class="empty">'+esc(t("noMatch"))+'</div>';
      list.querySelectorAll("[data-relation-index]").forEach((button) => button.addEventListener("click",() => { selectedRelationId=filtered[Number(button.dataset.relationIndex)].id; renderRelations(); })); renderRelationTrace();
    }
    function renderRelationTrace() {
      const issue=relationIssues().find((item) => item.id===selectedRelationId)||null, root=document.getElementById("relationTrace"); if(!issue){root.innerHTML='<div class="empty">'+esc(t("chooseRelation"))+'</div>';return;}
      const resources=snapshot.resources.filter((resource) => issue.assetIds.includes(resource.id)), title=language==="zh"?issue.title:issue.titleEn, detail=language==="zh"?issue.detail:issue.detailEn, action=language==="zh"?issue.action:issue.actionEn, shown=resources.slice(0,16);
      root.innerHTML='<div class="traceIntro"><h4>'+esc(title)+'</h4><p>'+esc(detail)+' '+esc(t("next"))+': '+esc(action)+'</p></div>'+shown.map(renderTraceResource).join("")+(resources.length>shown.length?'<div class="empty">'+esc(resources.length-shown.length)+' '+esc(t("omitted"))+'</div>':'');
    }
    function renderTraceResource(resource) {
      const canonical=resource.lineage?.canonical, installation=resource.lineage?.installation, binding=resource.lineage?.binding, canonicalName=canonical?.source||canonical?.sourceType||shortId(resource.canonicalSourceId), installMeta=(installation?.role||'—')+' · '+shortHash(installation?.contentHash||resource.identity?.contentHash), bindMeta=(binding?.discovery||'—')+' · '+(resource.consumer?runtimeLabel(resource.consumer):t("inventoryOnly")), pathMeta=resource.identity?.isSymlink?resource.path+' → '+(resource.identity.realpath||'—'):resource.path;
      return '<article class="traceResource"><div class="traceResourceHead"><div><strong>'+esc(resource.name)+'</strong><span>'+esc(typeLabel(resource.type))+' · '+esc(ownerLabel(resource.owner))+'</span></div>'+healthBadge(resource.health||"healthy")+'</div><div class="chain"><div class="chainStep"><label>'+esc(t("canonical"))+'</label><strong>'+esc(canonicalName)+'</strong><small>'+esc(canonical?.sourcePath||shortId(resource.canonicalSourceId))+' · '+esc(canonical?.confidence||'unknown')+'</small></div><div class="chainStep"><label>'+esc(t("installation"))+'</label><strong>'+esc(installMeta)+'</strong><small>'+esc(pathMeta)+'</small></div><div class="chainStep"><label>'+esc(t("bindingConsumer"))+'</label><strong>'+esc(bindMeta)+'</strong><small>'+esc(binding ? (binding.visibility||'visible') : 'inventory')+' · enabled '+esc(stateLabel(stateValue(resource.states.enabled)))+' · loaded '+esc(stateLabel(stateValue(resource.states.loaded)))+'</small></div></div></article>';
    }
    function pluginStateCount(key,value) { return globalPlugins.filter((plugin) => stateValue(plugin[key])===value).length; }
    function renderPlugins() {
      const total=globalPlugins.length, kpis=[{key:"packages",value:total,unknown:0},{key:"bundled",value:pluginStateCount("bundled",true),unknown:pluginStateCount("bundled","unknown")},{key:"installed",value:pluginStateCount("installed",true),unknown:pluginStateCount("installed","unknown")},{key:"enabled",value:pluginStateCount("enabled",true),unknown:pluginStateCount("enabled","unknown")},{key:"loaded",value:pluginStateCount("loaded",true),unknown:pluginStateCount("loaded","unknown")}];
      document.getElementById("pluginKpis").innerHTML=kpis.map((item) => '<div class="pluginKpi"><span>'+esc(t(item.key))+'</span><strong>'+esc(item.value)+'</strong><small>? '+esc(item.unknown)+'</small></div>').join("");
      const kindSelect=document.getElementById("pluginKind"), selectedKind=kindSelect.value||"all", kinds=["all",...new Set(globalPlugins.map((plugin) => plugin.kind))]; kindSelect.innerHTML=kinds.map((kind) => '<option value="'+esc(kind)+'">'+esc(kind==="all"?t("kindFilter")+': '+t("all"):kind)+'</option>').join(""); kindSelect.value=selectedKind;
      const stateSelect=document.getElementById("pluginState"), selectedState=stateSelect.value||"all"; stateSelect.innerHTML=['all','installed','enabled','loaded','unknown'].map((key) => '<option value="'+key+'">'+esc(key==="all"?t("stateFilter")+': '+t("all"):t(key))+'</option>').join(""); stateSelect.value=selectedState;
      const query=document.getElementById("pluginSearch").value.trim().toLowerCase(), items=globalPlugins.filter((plugin) => (kindSelect.value==="all"||plugin.kind===kindSelect.value)&&(stateSelect.value==="all"||(stateSelect.value==="unknown"?["bundled","installed","enabled","loaded"].some((key) => stateValue(plugin[key])==="unknown"):stateValue(plugin[stateSelect.value])===true))&&(!query||(plugin.name+' '+plugin.manifestPath+' '+plugin.storageOwner+' '+plugin.kind).toLowerCase().includes(query)));
      document.getElementById("pluginResultCount").textContent=items.length+' '+t("matching"); const root=document.getElementById("pluginList"), header='<div class="pluginHeader"><span>'+esc(t("packages"))+'</span><span>'+esc(t("storage"))+'</span><span>'+esc(t("bundled"))+'</span><span>'+esc(t("installed"))+'</span><span>'+esc(t("enabled"))+'</span><span>'+esc(t("loaded"))+'</span><span>Manifest</span></div>';
      root.innerHTML=header+(items.length?items.map((plugin) => '<article class="pluginRow"><div class="pluginName"><strong>'+esc(plugin.name)+(plugin.version?'@'+esc(plugin.version):'')+'</strong><span>'+esc(plugin.kind)+'</span></div><span>'+esc(ownerLabel(plugin.storageOwner))+'</span>'+stateCell(t("bundled"),plugin.bundled)+stateCell(t("installed"),plugin.installed)+stateCell(t("enabled"),plugin.enabled)+stateCell(t("loaded"),plugin.loaded)+'<span class="manifest">'+esc(plugin.manifestPath)+'</span></article>').join(""):'<div class="empty">'+esc(t("noMatch"))+'</div>');
    }
    function openResources(filter) { resourceFilter={ids:filter?.ids||null,consumer:filter?.consumer||"all",type:filter?.type||"all",mode:filter?.mode||"all"}; document.getElementById("resourceSearch").value=""; setView("resources"); renderResources(); }
    function renderResourceControls() {
      const runtime=document.getElementById("resourceRuntime"); runtime.innerHTML='<option value="all">'+esc(t("allRuntimes"))+'</option>'+snapshot.systems.map((system) => '<option value="'+esc(system.consumer)+'">'+esc(system.label)+'</option>').join(""); runtime.value=resourceFilter.consumer;
      const type=document.getElementById("resourceType"), types=[...new Set(snapshot.resources.map((resource) => resource.type))].sort(); type.innerHTML='<option value="all">'+esc(t("allTypes"))+'</option>'+types.map((value) => '<option value="'+esc(value)+'">'+esc(typeLabel(value))+'</option>').join(""); type.value=resourceFilter.type;
      const mode=document.getElementById("resourceMode"); mode.innerHTML=[['all','allResources'],['visible','visibleOnly'],['inventory','inventoryMode'],['unknown','unknownMode'],['diagnostic','diagnosticMode']].map(([value,label]) => '<option value="'+value+'">'+esc(t(label))+'</option>').join(""); mode.value=resourceFilter.mode;
    }
    function filteredResources() {
      let items=snapshot.resources.slice(); if(resourceFilter.ids?.length) items=items.filter((item) => resourceFilter.ids.includes(item.id)); if(resourceFilter.consumer!=="all") items=items.filter((item) => item.consumer===resourceFilter.consumer); if(resourceFilter.type!=="all") items=items.filter((item) => item.type===resourceFilter.type); if(resourceFilter.mode==="visible") items=items.filter((item) => item.effective); if(resourceFilter.mode==="inventory") items=items.filter((item) => !item.effective); if(resourceFilter.mode==="unknown") items=items.filter((item) => item.bindingId&&(stateValue(item.states.enabled)==="unknown"||stateValue(item.states.loaded)==="unknown")); if(resourceFilter.mode==="diagnostic") items=items.filter((item) => item.diagnosisKinds?.length);
      const query=document.getElementById("resourceSearch").value.trim().toLowerCase(); if(query) items=items.filter((item) => (item.name+' '+item.path+' '+(item.identity?.realpath||'')+' '+(item.identity?.contentHash||'')+' '+(item.lineage?.canonical?.source||'')+' '+item.owner+' '+(item.consumer||'')+' '+JSON.stringify(item.states)).toLowerCase().includes(query)); const rank={warning:3,attention:2,healthy:1,inactive:0}; return items.sort((a,b) => rank[b.health||"healthy"]-rank[a.health||"healthy"]||Number(Boolean(b.diagnosisKinds?.length))-Number(Boolean(a.diagnosisKinds?.length))||a.name.localeCompare(b.name));
    }
    function renderResources() { renderResourceControls(); const items=filteredResources(), shown=items.slice(0,300); document.getElementById("resourceResultCount").textContent=items.length+' '+t("matching"); document.getElementById("resourceList").innerHTML=shown.length?shown.map(renderResource).join("")+(items.length>shown.length?'<div class="empty">'+esc(items.length-shown.length)+' '+esc(t("omitted"))+'</div>':''):'<div class="empty">'+esc(t("noMatch"))+'</div>'; }
    function renderResource(item) {
      const canonical=item.lineage?.canonical, installation=item.lineage?.installation, binding=item.lineage?.binding, storedReason=language==="zh"?item.reason:item.reasonEn, reason=storedReason||t(item.effective?"visibleReason":"inventoryReason"), canonicalText=canonical?.source||canonical?.sourceType||shortId(item.canonicalSourceId), pathText=item.identity?.isSymlink?item.path+' → '+(item.identity.realpath||item.path):item.path;
      const stateStrip=stateCell(t("present"),item.states.present)+stateCell(t("valid"),item.states.valid)+stateCell(t("enabled"),item.states.enabled)+stateCell(t("loaded"),item.states.loaded);
      const chain='<div class="chain"><div class="chainStep"><label>'+esc(t("canonical"))+'</label><strong>'+esc(canonicalText)+'</strong><small>'+esc(canonical?.sourcePath||shortId(item.canonicalSourceId))+' · '+esc(canonical?.confidence||'unknown')+'</small></div><div class="chainStep"><label>'+esc(t("installation"))+'</label><strong>'+esc(installation?.role||'—')+' · '+esc(shortHash(item.identity?.contentHash))+'</strong><small>'+esc(ownerLabel(item.owner))+' · '+esc(installation ? (installation.locationCount||1) : 0)+' '+esc(t("locations"))+'</small></div><div class="chainStep"><label>'+esc(t("bindingConsumer"))+'</label><strong>'+esc(binding?.discovery||t("inventoryOnly"))+' → '+esc(runtimeLabel(item.consumer))+'</strong><small>'+esc(binding ? (binding.visibility||'visible') : 'inventory')+' · '+esc(t("priority"))+' '+esc(binding ? (binding.priority??100) : '—')+'</small></div></div>';
      const facts='<div class="facts"><div class="fact"><label>'+esc(t("locations"))+'</label><code>'+esc(pathText)+'</code></div><div class="fact"><label>'+esc(t("hash"))+'</label><code>'+esc(item.identity?.contentHash||'—')+'</code></div><div class="fact"><label>'+esc(t("facts"))+'</label><code>symlink='+esc(Boolean(item.identity?.isSymlink))+' · dev='+esc(item.identity?.device||'—')+' · inode='+esc(item.identity?.inode||'—')+'</code></div><div class="fact"><label>'+esc(t("ids"))+'</label><code>'+esc(shortId(item.canonicalSourceId))+' · '+esc(shortId(item.installationId))+' · '+esc(shortId(item.bindingId))+'</code></div></div>';
      return '<details class="resourceCard"><summary><div class="resourceSummary"><div class="resourceName"><strong>'+esc(item.name)+'</strong><span>'+esc(typeLabel(item.type))+' · '+esc(item.scope||"global")+'</span></div><div class="resourceOwner"><strong>'+esc(ownerLabel(item.owner))+'</strong><span>'+esc(t("placement"))+': '+esc(item.placementOwner||item.owner)+'</span></div><div class="resourceConsumer"><strong>'+esc(runtimeLabel(item.consumer))+'</strong><span>'+esc(item.effective?t("visible"):t("inactive"))+'</span></div><div class="stateStrip">'+stateStrip+'</div><span class="chevron">›</span></div></summary><div class="resourceDetails"><div class="resourceVerdict"><p>'+esc(reason||'—')+'</p>'+healthBadge(item.health||"healthy")+'</div>'+chain+facts+'</div></details>';
    }
    function renderAll() { renderHero(); renderNavigation(); renderEvidenceCards(); renderQueue(); renderRuntimeMatrix(); renderDistribution(); renderRelations(); renderPlugins(); renderResources(); setView(activeView,false); }

    document.querySelectorAll(".navButton").forEach((button) => button.addEventListener("click",() => setView(button.dataset.view)));
    document.querySelectorAll("[data-open-resources]").forEach((button) => button.addEventListener("click",() => openResources({mode:"all"})));
    document.getElementById("scopeMode").addEventListener("change",applyScope); document.getElementById("projectSelect").addEventListener("change",applyScope);
    document.getElementById("pluginSearch").addEventListener("input",renderPlugins); document.getElementById("pluginKind").addEventListener("change",renderPlugins); document.getElementById("pluginState").addEventListener("change",renderPlugins);
    document.getElementById("resourceSearch").addEventListener("input",renderResources); document.getElementById("resourceRuntime").addEventListener("change",(event) => {resourceFilter.consumer=event.target.value;renderResources();}); document.getElementById("resourceType").addEventListener("change",(event) => {resourceFilter.type=event.target.value;renderResources();}); document.getElementById("resourceMode").addEventListener("change",(event) => {resourceFilter.mode=event.target.value;resourceFilter.ids=null;renderResources();});

    const aiModal=document.getElementById("aiModal"), aiContext=document.getElementById("aiContext");
    document.getElementById("showAiContext").addEventListener("click",() => { const index=currentScopeIndex(); aiContext.textContent=scopeContexts[index]?.[language]||""; updateFullContextLink(); aiModal.classList.add("open"); });
    document.getElementById("closeAiContext").addEventListener("click",() => aiModal.classList.remove("open"));
    document.getElementById("copyAiContext").addEventListener("click",async(event) => { const text=aiContext.textContent||""; try{await navigator.clipboard.writeText(text);}catch{const input=document.createElement("textarea");input.value=text;document.body.appendChild(input);input.select();document.execCommand("copy");input.remove();} event.target.textContent=t("copied");setTimeout(() => {event.target.textContent=t("copyMarkdown");},1200); });
    document.getElementById("langToggle").addEventListener("click",() => { language=language==="zh"?"en":"zh"; applyLanguage(); renderAll(); if(aiModal.classList.contains("open")){const index=currentScopeIndex();aiContext.textContent=scopeContexts[index]?.[language]||"";} updateFullContextLink(); });
    aiModal.addEventListener("click",(event) => {if(event.target===aiModal)aiModal.classList.remove("open");}); document.addEventListener("keydown",(event) => {if(event.key==="Escape")aiModal.classList.remove("open");});
    applyLanguage(); applyScope();
  </script>
</body>
</html>`;
}
