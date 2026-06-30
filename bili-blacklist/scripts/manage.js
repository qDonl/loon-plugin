/**
 * B站黑名单 Web 管理页
 * 拦截: http://bili.blacklist* (http-request)
 *
 * 用法：Loon 运行中，Safari 访问 http://bili.blacklist（或点插件详情「主页」链接）
 *
 * 路由:
 *   GET /              → 管理主页（UP主 / 分区 两个 tab）
 *   GET /remove-up     → 移除单个 UP    ?up_id=xxx
 *   GET /remove-part   → 移除单个分区   ?tid=xxx
 *   GET /clear-up      → 清空 UP 黑名单
 *   GET /clear-part    → 清空分区黑名单
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";
const UP_NAME_MAP_KEY    = "bili_up_name_map";

(function main() {
  const url      = $request.url || "";
  const pathFull = url.split("?")[0];
  const queryStr = url.split("?")[1] || "";

  const params = {};
  queryStr.split("&").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) params[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1));
  });

  const upList   = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY)   || "[]");
  const partList = JSON.parse($persistentStore.read(PART_BLACKLIST_KEY) || "[]");
  const upNameMap = JSON.parse($persistentStore.read(UP_NAME_MAP_KEY)  || "{}");

  // 补全 up_name 为空的条目（历史数据修复）
  upList.forEach(u => {
    if (!u.up_name && upNameMap[String(u.up_id)]) {
      u.up_name = upNameMap[String(u.up_id)];
    }
  });

  if (pathFull.endsWith("/remove-up")) {
    const upId = params.up_id;
    if (!upId) return jsonDone({ success: false, error: "missing up_id" });
    const newList = upList.filter(u => String(u.up_id) !== upId);
    $persistentStore.write(JSON.stringify(newList), UP_BLACKLIST_KEY);
    return jsonDone({ success: true, count: newList.length });
  }

  if (pathFull.endsWith("/remove-part")) {
    const tid = params.tid;
    if (!tid) return jsonDone({ success: false, error: "missing tid" });
    const newList = partList.filter(p => String(p.tid) !== tid);
    $persistentStore.write(JSON.stringify(newList), PART_BLACKLIST_KEY);
    return jsonDone({ success: true, count: newList.length });
  }

  if (pathFull.endsWith("/clear-up")) {
    $persistentStore.write("[]", UP_BLACKLIST_KEY);
    return jsonDone({ success: true, count: 0 });
  }

  if (pathFull.endsWith("/clear-part")) {
    $persistentStore.write("[]", PART_BLACKLIST_KEY);
    return jsonDone({ success: true, count: 0 });
  }

  $done({
    response: {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      body:    buildHTML(upList, partList),
    },
  });
})();

/* ─────────────── helpers ─────────────── */

function jsonDone(obj) {
  $done({
    response: {
      status:  200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body:    JSON.stringify(obj),
    },
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch (_) { return ""; }
}

function buildUpRows(upList) {
  if (upList.length === 0) {
    return `<div class="empty"><span class="eico">👤</span>UP 黑名单为空<br><small>首页长按视频 → 不感兴趣 → UP主：xxx</small></div>`;
  }
  let rows = "";
  [...upList].reverse().forEach((u, i, arr) => {
    const sep  = i < arr.length - 1 ? " sep" : "";
    const name = u.up_name || u.up_id;
    rows += `
<div class="item${sep}">
  <div class="info">
    <div class="name">${esc(name)}</div>
    ${u.up_name ? `<div class="sub">UID: ${esc(u.up_id)}</div>` : ""}
  </div>
  <span class="date">${fmtDate(u.added_at)}</span>
  <button class="del" onclick="delUp('${esc(u.up_id)}','${esc(name)}')">移除</button>
</div>`;
  });
  return rows;
}

function buildPartRows(partList) {
  if (partList.length === 0) {
    return `<div class="empty"><span class="eico">📂</span>分区黑名单为空<br><small>首页长按视频 → 不感兴趣 → 频道：xxx</small></div>`;
  }
  let rows = "";
  [...partList].reverse().forEach((p, i, arr) => {
    const sep  = i < arr.length - 1 ? " sep" : "";
    const name = p.tname || p.tid;
    rows += `
<div class="item${sep}">
  <div class="info">
    <div class="name">${esc(name)}</div>
    ${p.tname ? `<div class="sub">TID: ${esc(p.tid)}</div>` : ""}
  </div>
  <span class="date">${fmtDate(p.added_at)}</span>
  <button class="del" onclick="delPart('${esc(p.tid)}','${esc(name)}')">移除</button>
</div>`;
  });
  return rows;
}

function buildHTML(upList, partList) {
  const BASE     = "http://bili.blacklist";
  const upRows   = buildUpRows(upList);
  const partRows = buildPartRows(partList);

  const upCard   = upList.length   > 0 ? `<div class="sec-title">已屏蔽 ${upList.length} 位 UP 主</div><div class="card">${upRows}</div>` : upRows;
  const partCard = partList.length > 0 ? `<div class="sec-title">已屏蔽 ${partList.length} 个分区</div><div class="card">${partRows}</div>` : partRows;

  const upClearBtn   = upList.length   > 0 ? `<button class="clear-btn" onclick="clearUp(${upList.length})">清空全部 ${upList.length} 位 UP 黑名单</button>` : "";
  const partClearBtn = partList.length > 0 ? `<button class="clear-btn" onclick="clearPart(${partList.length})">清空全部 ${partList.length} 个分区黑名单</button>` : "";

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>B站黑名单</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,sans-serif;background:#f2f2f7;color:#1c1c1e;padding-bottom:48px}
.topbar{position:sticky;top:0;z-index:9;background:rgba(242,242,247,.9);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:.5px solid rgba(0,0,0,.12)}
.topbar-inner{display:flex;align-items:baseline;gap:8px;padding:12px 16px 0}
.topbar h1{font-size:17px;font-weight:700}
.topbar .cnt{font-size:13px;color:#8e8e93}
.tabs{display:flex;padding:0 16px}
.tab{flex:1;padding:10px 0;text-align:center;font-size:15px;font-weight:500;color:#8e8e93;border-bottom:2px solid transparent;cursor:pointer;transition:color .15s,border-color .15s}
.tab.active{color:#fb7299;border-bottom-color:#fb7299}
.pane{display:none;padding-top:4px}
.pane.active{display:block}
.sec-title{font-size:13px;color:#8e8e93;padding:20px 16px 8px;font-weight:500;letter-spacing:.3px}
.card{background:#fff;margin:0 16px 4px;border-radius:12px;overflow:hidden}
.item{display:flex;align-items:center;padding:12px 16px}
.item.sep{border-bottom:.5px solid rgba(0,0,0,.08)}
.info{flex:1;min-width:0}
.name{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{font-size:12px;color:#8e8e93;margin-top:2px}
.date{font-size:12px;color:#c7c7cc;margin:0 10px;white-space:nowrap;flex-shrink:0}
.del{color:#ff3b30;font-size:14px;font-weight:500;border:none;background:none;padding:4px 0 4px 10px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.empty{text-align:center;padding:64px 32px;color:#8e8e93;line-height:2}
.eico{font-size:48px;display:block;margin-bottom:12px}
.actions{padding:16px 16px 0}
.clear-btn{display:block;width:100%;padding:14px;background:#ff3b30;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer}
.tip{margin:16px 16px 0;background:#fff;border-radius:12px;padding:16px}
.tip h3{font-size:14px;font-weight:600;margin-bottom:10px;color:#1c1c1e}
.tip li{font-size:14px;color:#444;line-height:2;margin-left:18px}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <h1>哔哩哔哩黑名单</h1>
    <span class="cnt">UP ${upList.length} · 分区 ${partList.length}</span>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="switchPane('up',this)">UP 主 · ${upList.length}</div>
    <div class="tab" onclick="switchPane('part',this)">分区 · ${partList.length}</div>
  </div>
</div>

<div id="pane-up" class="pane active">
  ${upCard}
  <div class="actions">${upClearBtn}</div>
  <div class="tip">
    <h3>📖 如何屏蔽 UP 主</h3>
    <ul>
      <li>首页长按视频卡片</li>
      <li>选择「不感兴趣」</li>
      <li>再选「UP主：xxx」</li>
      <li>插件自动记录，下次刷新生效</li>
    </ul>
  </div>
</div>

<div id="pane-part" class="pane">
  ${partCard}
  <div class="actions">${partClearBtn}</div>
  <div class="tip">
    <h3>📖 如何屏蔽分区</h3>
    <ul>
      <li>首页长按视频卡片</li>
      <li>选择「不感兴趣」</li>
      <li>再选「频道：xxx」</li>
      <li>插件自动记录，下次刷新生效</li>
    </ul>
  </div>
</div>

<script>
const BASE = '${BASE}';
function switchPane(id, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pane').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('pane-' + id).classList.add('active');
}
function delUp(uid, name) {
  if (!confirm('确认移除 UP「' + name + '」？')) return;
  fetch(BASE + '/remove-up?up_id=' + encodeURIComponent(uid))
    .then(r => r.json()).then(d => { if (d.success) location.reload(); });
}
function delPart(tid, name) {
  if (!confirm('确认移除分区「' + name + '」？')) return;
  fetch(BASE + '/remove-part?tid=' + encodeURIComponent(tid))
    .then(r => r.json()).then(d => { if (d.success) location.reload(); });
}
function clearUp(n) {
  if (!confirm('确认清空全部 ' + n + ' 位 UP 黑名单？\\n此操作不可恢复。')) return;
  fetch(BASE + '/clear-up').then(r => r.json()).then(d => { if (d.success) location.reload(); });
}
function clearPart(n) {
  if (!confirm('确认清空全部 ' + n + ' 个分区黑名单？\\n此操作不可恢复。')) return;
  fetch(BASE + '/clear-part').then(r => r.json()).then(d => { if (d.success) location.reload(); });
}
</script>
</body>
</html>`;
}
