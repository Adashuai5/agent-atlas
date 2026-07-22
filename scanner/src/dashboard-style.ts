export const dashboardCss = String.raw`
:root {
  --canvas:#f2f4f7; --surface:#fff; --surface-subtle:#f8fafc; --ink:#172033; --muted:#667085;
  --line:#e1e6ee; --line-strong:#ccd4df; --navy:#111a2c; --navy-2:#1b2942; --blue:#4967e8;
  --blue-soft:#eef2ff; --healthy:#16815d; --healthy-soft:#eaf7f1; --attention:#b66b08;
  --attention-soft:#fff5df; --warning:#c33f36; --warning-soft:#fff0ee; --inactive:#6f7d91;
  --shadow:0 12px 34px rgba(21,32,51,.075); --radius:16px;
}
* { box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { margin:0; min-height:100vh; background:var(--canvas); color:var(--ink); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
button,input,select { font:inherit; }
button { cursor:pointer; }
button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible { outline:3px solid rgba(73,103,232,.25); outline-offset:2px; }
.app { width:min(1420px,100%); margin:0 auto; padding:18px 22px 40px; }
.topbar { display:flex; justify-content:space-between; align-items:center; gap:18px; margin-bottom:14px; }
.brand { display:flex; align-items:center; gap:11px; min-width:0; }
.mark { width:40px; height:40px; flex:0 0 auto; border-radius:12px; display:grid; place-items:center; background:var(--navy); color:#fff; font-weight:900; letter-spacing:-1px; }
h1 { margin:0; font-size:18px; line-height:1.15; letter-spacing:-.015em; }
.productLabel { margin-top:2px; color:var(--muted); font-size:11px; }
.scopeControls { display:flex; align-items:center; gap:6px; margin-left:8px; }
.scopeSelect { max-width:240px; height:34px; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink); padding:0 9px; }
.scopeSelect[hidden] { display:none; }
.topActions { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
.scanMeta { color:var(--muted); font-size:11px; margin-right:5px; }
.topButton { min-height:36px; border:1px solid var(--line); border-radius:9px; background:#fff; color:#344054; padding:0 11px; }
.topButton.primary { border-color:var(--navy); background:var(--navy); color:#fff; }
.fullContextLink { display:inline-flex; align-items:center; min-height:34px; border:1px solid var(--line); border-radius:8px; color:#315e9a; padding:0 10px; text-decoration:none; }
.hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(300px,.55fr); gap:24px; align-items:stretch; padding:25px 26px; border-radius:20px; background:linear-gradient(135deg,var(--navy),var(--navy-2)); color:#fff; box-shadow:0 18px 44px rgba(17,26,44,.16); }
.eyebrow { display:flex; align-items:center; gap:8px; color:#aebbd0; font-size:11px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; }
.eyebrow i { width:8px; height:8px; border-radius:50%; background:#8da2ff; box-shadow:0 0 0 4px rgba(141,162,255,.13); }
.hero h2 { margin:11px 0 0; max-width:780px; font-size:clamp(25px,3vw,38px); line-height:1.08; letter-spacing:-.035em; }
.hero p { margin:10px 0 0; max-width:820px; color:#c3ccda; font-size:14px; }
.heroBadges { display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }
.heroBadge { display:inline-flex; align-items:center; gap:7px; min-height:30px; border:1px solid rgba(255,255,255,.13); border-radius:999px; background:rgba(255,255,255,.06); color:#d8dfeb; padding:0 10px; font-size:11px; }
.heroBadge i { width:7px; height:7px; border-radius:50%; background:var(--badge); }
.heroSignals { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.heroSignal { display:flex; flex-direction:column; justify-content:space-between; min-height:118px; padding:15px; border:1px solid rgba(255,255,255,.13); border-radius:14px; background:rgba(255,255,255,.055); }
.heroSignal span { color:#aebbd0; font-size:11px; }
.heroSignal strong { display:block; margin:8px 0 5px; font-size:29px; line-height:1; }
.heroSignal small { color:#c3ccda; font-size:11px; }
.workspaceNav { position:sticky; z-index:20; top:0; display:flex; gap:4px; margin:14px 0; padding:5px; border:1px solid var(--line); border-radius:13px; background:rgba(255,255,255,.93); box-shadow:0 8px 24px rgba(21,32,51,.06); backdrop-filter:blur(12px); overflow-x:auto; }
.navButton { min-height:40px; flex:0 0 auto; border:0; border-radius:9px; background:transparent; color:#59667a; padding:0 14px; font-size:12px; font-weight:700; }
.navButton.active { background:var(--navy); color:#fff; }
.navButton span:last-child { margin-left:6px; opacity:.68; font-weight:600; }
.view { display:none; }
.view.active { display:block; }
.panel { min-width:0; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); box-shadow:var(--shadow); overflow:hidden; }
.panelHead { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding:17px 18px 14px; border-bottom:1px solid var(--line); }
.panelHead h3 { margin:0; font-size:16px; letter-spacing:-.01em; }
.panelHead p { margin:4px 0 0; color:var(--muted); font-size:11px; }
.textButton { min-height:34px; border:0; background:transparent; color:#405fc9; padding:0 4px; font-size:12px; }
.evidenceGrid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:12px; }
.evidenceCard { min-height:128px; display:flex; flex-direction:column; border:1px solid var(--line); border-top:3px solid var(--tone); border-radius:14px; background:#fff; color:inherit; padding:15px 16px; text-align:left; box-shadow:0 8px 24px rgba(21,32,51,.045); }
.evidenceCard .label { color:var(--muted); font-size:11px; font-weight:700; }
.evidenceCard strong { display:block; margin:10px 0 7px; font-size:27px; line-height:1; letter-spacing:-.03em; }
.evidenceCard p { margin:auto 0 0; color:#59667a; font-size:11px; }
.primaryGrid { display:grid; grid-template-columns:minmax(330px,.82fr) minmax(520px,1.18fr); gap:12px; }
.queueList { padding:8px; }
.queueItem { width:100%; min-height:76px; display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:11px; align-items:start; border:0; border-bottom:1px solid var(--line); background:#fff; color:var(--ink); padding:12px 10px; text-align:left; }
.queueItem:last-child { border-bottom:0; }
.queueItem:hover { background:var(--surface-subtle); border-radius:9px; }
.queueItem.static { cursor:default; opacity:1; }
.queueItem.static:hover { background:#fff; border-radius:0; }
.queueIcon { width:28px; height:28px; display:grid; place-items:center; border-radius:9px; background:var(--soft); color:var(--tone); font-size:13px; font-weight:900; }
.queueItem strong { display:block; font-size:12px; }
.queueItem p { margin:4px 0 0; color:var(--muted); font-size:11px; }
.queueMeta { color:var(--tone); font-size:10px; font-weight:800; text-transform:uppercase; }
.queueMeta small { display:block; margin-top:3px; color:var(--muted); font-size:8px; font-weight:600; text-transform:none; white-space:nowrap; }
.zeroState { padding:22px 18px; text-align:center; color:var(--muted); }
.zeroState strong { display:block; margin-bottom:4px; color:var(--ink); }
.runtimeTable { padding:8px 14px 14px; }
.runtimeHeader,.runtimeRow { display:grid; grid-template-columns:minmax(110px,1.25fr) repeat(3,minmax(92px,.8fr)) minmax(110px,.85fr); gap:8px; align-items:center; }
.runtimeHeader { min-height:38px; color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.035em; }
.runtimeRow { width:100%; min-height:72px; border:0; border-top:1px solid var(--line); background:#fff; color:inherit; padding:9px 0; text-align:left; }
.runtimeRow:hover { background:var(--surface-subtle); }
.runtimeName strong,.runtimeName span { display:block; }
.runtimeName span { margin-top:2px; color:var(--muted); font-size:10px; }
.runtimeMetric strong { display:block; font-size:14px; white-space:nowrap; }
.runtimeMetric span { color:var(--muted); font-size:10px; }
.runtimeStatus { display:inline-flex; align-items:center; gap:6px; width:max-content; border-radius:999px; background:var(--soft); color:var(--tone); padding:5px 8px; font-size:10px; font-weight:800; }
.runtimeStatus i { width:6px; height:6px; border-radius:50%; background:var(--tone); }
.distribution { margin-top:12px; }
.distributionBody { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:22px; padding:17px 18px 19px; }
.barList { display:grid; gap:11px; }
.barRow { display:grid; grid-template-columns:90px minmax(0,1fr) 48px; gap:10px; align-items:center; }
.barRow button { border:0; background:transparent; color:var(--ink); padding:0; text-align:left; font-size:12px; font-weight:700; }
.barTrack { height:8px; overflow:hidden; border-radius:999px; background:#edf0f5; }
.barFill { height:100%; width:var(--width); border-radius:inherit; background:linear-gradient(90deg,#6d83e9,#4967e8); }
.barValue { color:var(--muted); text-align:right; font-size:11px; }
.inventoryAside { min-width:190px; border-left:1px solid var(--line); padding-left:20px; }
.inventoryAside span { color:var(--muted); font-size:11px; }
.inventoryAside strong { display:block; margin:6px 0 10px; font-size:26px; }
.summaryGrid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:12px; }
.summaryCard { min-height:106px; border:1px solid var(--line); border-radius:14px; background:#fff; color:inherit; padding:14px; text-align:left; }
.summaryCard.active { border-color:#8da2ff; box-shadow:0 0 0 3px rgba(73,103,232,.09); }
.summaryCard span { color:var(--muted); font-size:11px; }
.summaryCard strong { display:block; margin-top:8px; font-size:25px; }
.summaryCard small { color:#59667a; }
.relationLayout { display:grid; grid-template-columns:minmax(300px,.75fr) minmax(0,1.25fr); gap:12px; }
.filterBar { display:flex; align-items:center; gap:7px; flex-wrap:wrap; padding:12px 14px; border-bottom:1px solid var(--line); }
.chip { min-height:32px; border:1px solid var(--line); border-radius:999px; background:#fff; color:#59667a; padding:0 10px; font-size:11px; }
.chip.active { border-color:var(--navy); background:var(--navy); color:#fff; }
.relationList { padding:6px 9px 12px; }
.relationItem { width:100%; display:block; border:0; border-bottom:1px solid var(--line); background:#fff; color:inherit; padding:12px 8px; text-align:left; }
.relationItem:hover,.relationItem.active { background:var(--surface-subtle); border-radius:9px; }
.relationTop { display:flex; justify-content:space-between; gap:10px; }
.relationTop strong { font-size:12px; }
.relationItem p { margin:5px 0 0; color:var(--muted); font-size:10px; }
.kindBadge { display:inline-flex; align-items:center; min-height:22px; border-radius:999px; background:var(--soft); color:var(--tone); padding:0 7px; font-size:9px; font-weight:900; text-transform:uppercase; }
.tracePanel { min-height:420px; }
.traceBody { padding:16px; }
.traceIntro { margin-bottom:14px; }
.traceIntro h4 { margin:0; font-size:16px; }
.traceIntro p { margin:5px 0 0; color:var(--muted); font-size:11px; }
.traceResource { border:1px solid var(--line); border-radius:13px; padding:13px; margin-bottom:10px; }
.traceResourceHead { display:flex; justify-content:space-between; gap:12px; margin-bottom:11px; }
.traceResourceHead strong,.traceResourceHead span { display:block; overflow-wrap:anywhere; }
.traceResourceHead span { color:var(--muted); font-size:10px; }
.chain { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px; }
.chainStep { position:relative; min-width:0; border-radius:10px; background:var(--surface-subtle); padding:10px; }
.chainStep:not(:last-child)::after { content:"→"; position:absolute; right:-17px; top:50%; color:#98a2b3; transform:translateY(-50%); }
.chainStep label { display:block; color:var(--muted); font-size:9px; font-weight:800; text-transform:uppercase; }
.chainStep strong { display:block; margin-top:4px; overflow-wrap:anywhere; font-size:11px; }
.chainStep small { display:block; margin-top:4px; color:#667085; overflow-wrap:anywhere; font-size:9px; }
.pluginKpis { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-bottom:12px; }
.pluginKpi { border:1px solid var(--line); border-radius:13px; background:#fff; padding:14px; }
.pluginKpi span { color:var(--muted); font-size:10px; }
.pluginKpi strong { display:block; margin:7px 0 4px; font-size:24px; }
.pluginKpi small { color:#667085; font-size:10px; }
.controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:13px 15px; border-bottom:1px solid var(--line); }
.search { width:min(330px,100%); height:38px; border:1px solid var(--line); border-radius:9px; padding:0 11px; background:#fff; color:var(--ink); }
.select { height:38px; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink); padding:0 9px; }
.resultCount { margin-left:auto; color:var(--muted); font-size:11px; }
.pluginList,.resourceList { padding:7px 14px 16px; }
.pluginHeader,.pluginRow { display:grid; grid-template-columns:minmax(170px,1.2fr) 100px repeat(4,92px) minmax(180px,1fr); gap:10px; align-items:center; }
.pluginHeader { min-height:36px; color:var(--muted); font-size:9px; font-weight:800; text-transform:uppercase; }
.pluginRow { min-height:57px; border-top:1px solid var(--line); }
.pluginName strong,.pluginName span { display:block; overflow-wrap:anywhere; }
.pluginName span,.manifest { color:var(--muted); font-size:9px; overflow-wrap:anywhere; }
.stateCell { display:inline-flex; align-items:center; gap:5px; width:max-content; border-radius:999px; background:var(--soft); color:var(--tone); padding:4px 7px; font-size:9px; font-weight:800; }
.stateCell i { width:6px; height:6px; border-radius:50%; background:var(--tone); }
.sectionNote { padding:11px 15px; border-top:1px solid var(--line); background:var(--surface-subtle); color:var(--muted); font-size:10px; }
.resourceCard { border-bottom:1px solid var(--line); }
.resourceCard:last-child { border-bottom:0; }
.resourceCard summary { list-style:none; cursor:pointer; padding:13px 2px; }
.resourceCard summary::-webkit-details-marker { display:none; }
.resourceSummary { display:grid; grid-template-columns:minmax(170px,1.2fr) 110px 110px minmax(280px,1.3fr) 22px; gap:12px; align-items:center; }
.resourceName strong,.resourceName span { display:block; overflow-wrap:anywhere; }
.resourceName span { color:var(--muted); font-size:10px; }
.resourceOwner span,.resourceConsumer span { display:block; color:var(--muted); font-size:9px; }
.stateStrip { display:flex; gap:5px; flex-wrap:wrap; }
.chevron { color:#98a2b3; transition:transform .16s ease; }
details[open] .chevron { transform:rotate(90deg); }
.resourceDetails { margin:0 0 12px; border:1px solid var(--line); border-radius:12px; background:var(--surface-subtle); padding:13px; }
.resourceVerdict { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; margin-bottom:12px; }
.resourceVerdict p { margin:0; color:#4f5e73; font-size:11px; }
.facts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px 16px; margin-top:11px; }
.fact { min-width:0; }
.fact label { display:block; color:var(--muted); font-size:9px; }
.fact code { display:block; margin-top:3px; color:#344054; font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; white-space:normal; }
.badge { display:inline-flex; align-items:center; gap:6px; width:max-content; border-radius:999px; background:var(--soft); color:var(--tone); padding:5px 8px; font-size:10px; font-weight:800; }
.badge i { width:6px; height:6px; border-radius:50%; background:var(--tone); }
.empty { padding:34px 18px; color:var(--muted); text-align:center; }
.modal { position:fixed; z-index:50; inset:0; display:none; place-items:center; padding:20px; background:rgba(9,17,29,.62); }
.modal.open { display:grid; }
.modalCard { width:min(880px,100%); max-height:min(820px,92vh); display:grid; grid-template-rows:auto minmax(0,1fr); border-radius:15px; background:#fff; box-shadow:0 30px 90px rgba(0,0,0,.3); overflow:hidden; }
.modalHead { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:14px 16px; border-bottom:1px solid var(--line); }
.modalHead h3 { margin:0; }
.modalActions { display:flex; gap:7px; }
.modalActions button { min-height:34px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); padding:0 10px; }
.modalActions button.primary { background:var(--navy); border-color:var(--navy); color:#fff; }
.aiContext { margin:0; padding:18px; overflow:auto; background:#f7f9fc; color:#25334a; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
@media (max-width:1050px) {
  .hero { grid-template-columns:1fr; }
  .heroSignals { max-width:520px; }
  .evidenceGrid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .primaryGrid,.relationLayout { grid-template-columns:1fr; }
  .pluginHeader,.pluginRow { grid-template-columns:minmax(160px,1fr) 88px repeat(4,76px); }
  .manifestHeader { display:none; }
  .pluginRow .manifest { grid-column:1 / -1; padding:0 0 9px; }
}
@media (max-width:720px) {
  .app { padding:10px 10px 28px; }
  .topbar { align-items:flex-start; flex-direction:column; }
  .brand { width:100%; align-items:center; flex-wrap:nowrap; }
  .scopeControls { width:auto; margin-left:auto; }
  .scopeSelect { min-width:0; max-width:145px; }
  .topActions { width:100%; justify-content:space-between; }
  .hero { padding:20px 18px; border-radius:17px; }
  .hero h2 { font-size:25px; overflow-wrap:anywhere; }
  .heroSignal { min-height:104px; }
  .workspaceNav { margin:10px 0; }
  .evidenceGrid,.summaryGrid { grid-template-columns:1fr 1fr; }
  .primaryGrid { display:flex; flex-direction:column; }
  .runtimeHeader { display:none; }
  .runtimeTable { display:grid; gap:9px; padding:11px; }
  .runtimeRow { grid-template-columns:1fr 1fr; gap:10px; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .runtimeName,.runtimeStatus { grid-column:1 / -1; }
  .distributionBody { grid-template-columns:1fr; }
  .inventoryAside { border-left:0; border-top:1px solid var(--line); padding:14px 0 0; }
  .pluginKpis { grid-template-columns:1fr 1fr; }
  .pluginKpi:first-child { grid-column:1 / -1; }
  .pluginHeader { display:none; }
  .pluginList { display:grid; gap:9px; padding:11px; }
  .pluginRow { grid-template-columns:1fr 1fr; gap:8px; border:1px solid var(--line); border-radius:12px; padding:11px; }
  .pluginName,.pluginRow .manifest { grid-column:1 / -1; }
  .resourceSummary { grid-template-columns:minmax(0,1fr) auto; gap:8px 12px; }
  .resourceOwner,.resourceConsumer,.stateStrip { grid-column:1 / -1; }
  .chain { grid-template-columns:1fr; gap:16px; }
  .chainStep:not(:last-child)::after { content:"↓"; right:auto; left:50%; top:auto; bottom:-16px; transform:translateX(-50%); }
  .facts { grid-template-columns:1fr; }
  .resultCount { width:100%; margin-left:0; }
}
@media (max-width:420px) {
  .scopeSelect { max-width:108px; }
  .topActions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .scanMeta { grid-column:1 / -1; margin:0; }
  .topButton { width:100%; }
  .hero { padding:18px; }
  .heroSignals,.evidenceGrid,.summaryGrid { grid-template-columns:1fr 1fr; }
  .heroSignal { min-height:96px; padding:12px; }
  .heroSignal strong { font-size:24px; }
  .heroBadge { padding:0 8px; font-size:10px; }
  .evidenceCard { min-height:112px; padding:12px; }
  .pluginKpis { grid-template-columns:1fr; }
  .pluginKpi:first-child { grid-column:auto; }
  .panelHead { display:block; }
  .panelHead .textButton { margin-top:8px; }
  .projectMode .brand { flex-wrap:wrap; }
  .projectMode .scopeControls { width:calc(100% - 51px); margin-left:51px; }
  .projectMode .scopeSelect { flex:1; max-width:none; }
  .modalHead { align-items:flex-start; flex-direction:column; }
  .modalActions { width:100%; flex-wrap:wrap; }
  .modalActions .fullContextLink,.modalActions button { flex:1 1 auto; justify-content:center; }
}
`;
