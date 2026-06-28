/**
 * 小红书黑名单 Web 管理页
 * 拦截: https://www.xiaohongshu.com/__rednot/manage* (http-request)
 *
 * 用法：Loon 运行中，Safari 访问 https://www.xiaohongshu.com/__rednot/manage
 * www.xiaohongshu.com 已在 MITM 列表，Loon 直接拦截并返回 HTML，无需 DNS 解析假域名。
 *
 * 路由（均在 /__rednot/manage 下）：
 *   GET /manage           → 黑名单管理页（HTML）
 *   GET /manage/remove    → 移除单个用户  ?user_id=xxx
 *   GET /manage/clear     → 清空全部黑名单
 */

const BLACKLIST_KEY = "rednot_blacklist";

(function main() {
  const fullUrl  = $request.url || "";
  const pathFull = fullUrl.split("?")[0];
  const queryStr = fullUrl.split("?")[1] || "";

  const params = {};
  queryStr.split("&").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) params[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1));
  });

  const raw       = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];

  /* ── 移除单个用户 ── */
  if (pathFull.endsWith("/remove")) {
    const userId = params.user_id;
    if (!userId) return jsonDone({ success: false, error: "missing user_id" });
    const newList = blacklist.filter(u => u.user_id !== userId);
    $persistentStore.write(JSON.stringify(newList), BLACKLIST_KEY);
    return jsonDone({ success: true, count: newList.length });
  }

  /* ── 清空全部 ── */
  if (pathFull.endsWith("/clear")) {
    $persistentStore.write(JSON.stringify([]), BLACKLIST_KEY);
    return jsonDone({ success: true, count: 0 });
  }

  /* ── 主页：返回 HTML 管理界面 ── */
  $done({
    response: {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      body:    buildHTML(blacklist),
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
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "";
  try { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}`; }
  catch(_) { return ""; }
}

function buildHTML(blacklist) {
  const total = blacklist.length;
  const BASE  = "https://www.xiaohongshu.com/__rednot/manage";

  const SOURCE = {
    manual:  { label: "手动配置", color: "#0055cc", bg: "#e5f0ff" },
    dislike: { label: "不感兴趣", color: "#b84800", bg: "#fff0e5" },
    detail:  { label: "详情页",   color: "#007800", bg: "#e5ffe8" },
  };

  /* 分组，组内最新在前 */
  const groups = {};
  [...blacklist].reverse().forEach(u => {
    const src = u.source || "dislike";
    if (!groups[src]) groups[src] = [];
    groups[src].push(u);
  });

  let rows = "";
  if (total === 0) {
    rows = `<div class="empty"><span class="eico">🚫</span>黑名单为空<br><small>长按「不感兴趣」或详情页按钮可添加</small></div>`;
  } else {
    const ORDER = ["manual", "dislike", "detail"];
    Object.keys(groups).forEach(s => { if (!ORDER.includes(s)) ORDER.push(s); });

    ORDER.forEach(src => {
      const list = groups[src];
      if (!list?.length) return;
      const s = SOURCE[src] || { label: src, color: "#555", bg: "#eee" };
      rows += `<div class="sec-title">${s.label} · ${list.length} 人</div><div class="card">`;
      list.forEach((u, i) => {
        const name  = u.nickname || "";
        const uid   = u.user_id;
        const disp  = name || uid;
        const sep   = i < list.length - 1 ? " sep" : "";
        const badge = `<span class="badge" style="color:${s.color};background:${s.bg}">${s.label}</span>`;
        rows += `
<div class="item${sep}">
  <div class="info">
    <div class="name">${esc(disp)}</div>
    ${name ? `<div class="uid">${esc(uid)}</div>` : ""}
  </div>
  <span class="date">${fmtDate(u.added_at)}</span>
  <button class="del" onclick="del('${esc(uid)}','${esc(disp)}')">移除</button>
</div>`;
      });
      rows += `</div>`;
    });
  }

  const clearBtn = total > 0
    ? `<button class="clear-btn" onclick="clearAll(${total})">清空全部 ${total} 条</button>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>小红书黑名单</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,sans-serif;background:#f2f2f7;color:#1c1c1e;padding-bottom:48px}
.topbar{position:sticky;top:0;z-index:9;background:rgba(242,242,247,.88);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);padding:12px 16px;border-bottom:.5px solid rgba(0,0,0,.12);display:flex;align-items:baseline;gap:8px}
.topbar h1{font-size:17px;font-weight:600}
.topbar .cnt{font-size:14px;color:#8e8e93}
.sec-title{font-size:13px;color:#8e8e93;padding:20px 16px 8px;font-weight:500;letter-spacing:.3px}
.card{background:#fff;margin:0 16px 4px;border-radius:12px;overflow:hidden}
.item{display:flex;align-items:center;padding:12px 16px}
.item.sep{border-bottom:.5px solid rgba(0,0,0,.08)}
.info{flex:1;min-width:0}
.name{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uid{font-size:12px;color:#8e8e93;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.date{font-size:12px;color:#c7c7cc;margin:0 10px;white-space:nowrap;flex-shrink:0}
.del{color:#ff3b30;font-size:14px;font-weight:500;border:none;background:none;padding:4px 0 4px 10px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.empty{text-align:center;padding:64px 32px;color:#8e8e93;line-height:2}
.eico{font-size:48px;display:block;margin-bottom:12px}
.actions{padding:20px 16px 0}
.clear-btn{display:block;width:100%;padding:14px;background:#ff3b30;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer}
.tip{margin:16px 16px 0;background:#fff;border-radius:12px;padding:16px}
.tip h3{font-size:14px;font-weight:600;margin-bottom:10px}
.tip li{font-size:14px;color:#444;line-height:2;margin-left:18px}
code{font-family:monospace;font-size:12px;background:#f2f2f7;padding:1px 5px;border-radius:4px}
</style>
</head>
<body>
<div class="topbar"><h1>小红书黑名单</h1><span class="cnt">${total} 人</span></div>
${rows}
<div class="actions">${clearBtn}</div>
<div class="tip">
  <h3>📖 使用说明</h3>
  <ul>
    <li><b>列表页屏蔽</b>：长按笔记 → 不感兴趣</li>
    <li><b>详情页屏蔽</b>：打开笔记 → 右下角红色悬浮按钮</li>
    <li><b>手动添加</b>：Loon → 插件配置 → 输入用户ID（逗号分隔）</li>
    <li><b>查看用户ID</b>：小红书主页 URL 中 <code>/user/profile/</code> 后的字符串</li>
    <li><b>移除单人</b>：点击上方列表中对应的「移除」按钮</li>
    <li><b>清空全部</b>：点击上方「清空全部」按钮</li>
  </ul>
</div>
<script>
const BASE = '${BASE}';
function del(uid, name) {
  if (!confirm('确认移除「' + name + '」？')) return;
  fetch(BASE + '/remove?user_id=' + encodeURIComponent(uid))
    .then(r => r.json()).then(d => { if (d.success) location.reload(); });
}
function clearAll(n) {
  if (!confirm('确认清空全部 ' + n + ' 条黑名单？\\n此操作不可恢复。')) return;
  fetch(BASE + '/clear').then(r => r.json()).then(d => { if (d.success) location.reload(); });
}
</script>
</body>
</html>`;
}
