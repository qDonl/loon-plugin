/**
 * B站「不感兴趣」拦截器
 * 拦截: https://app.bilibili.com/x/feed/dislike (http-request)
 *
 * 处理两类入口触发的请求：
 *
 *  A. 原生菜单入口（兜底机制）
 *     reason_id=4 → 「不感兴趣：UP」    → 写 UP 黑名单，放行至 B站服务器
 *     reason_id=3 → 「不感兴趣：频道」  → 写分区黑名单，放行至 B站服务器
 *
 *  B. 注入菜单入口（主动屏蔽）
 *     reason_id=1001 → 「加入UP黑名单：xxx」   → 写 UP 黑名单，返回 mock 200
 *     reason_id=1002 → 「加入分区黑名单：xxx」 → 写分区黑名单，返回 mock 200
 *     （自定义 id 不转发 B站，避免服务端因未知 reason_id 报错）
 *
 *  C. 其他 reason_id → 直接放行，不做处理
 *
 * UP / 分区名称查取顺序：
 *   1. reason.extend 字段（filter.js 注入，JSON 字符串）
 *   2. bili_aid_meta_map（以内容 avid 为键）
 *   3. 请求体中的 mid/up_id/tid 参数
 *   4. 以 ID 兜底存储
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";
const META_MAP_KEY       = "bili_aid_meta_map";

function parseKV(str) {
  const params = {};
  (str || "").split("&").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) {
      try {
        params[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1));
      } catch (_) {}
    }
  });
  return params;
}

function tryJSON(str) {
  try { return JSON.parse(str || "{}"); } catch (_) { return {}; }
}

function mockSuccess() {
  return $done({
    response: {
      status:  200,
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code: 0, message: "OK", ttl: 1 }),
    },
  });
}

function addToUpBlacklist(upId, upName, source) {
  const list = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY) || "[]");
  if (list.some(u => String(u.up_id) === upId)) return;
  list.push({ up_id: upId, up_name: upName, source, added_at: new Date().toISOString() });
  $persistentStore.write(JSON.stringify(list), UP_BLACKLIST_KEY);
  $notification.post("哔哩哔哩黑名单", "已将 UP 加入黑名单", upName || `UID: ${upId}`);
}

function addToPartBlacklist(tid, tname) {
  const list = JSON.parse($persistentStore.read(PART_BLACKLIST_KEY) || "[]");
  if (list.some(p => String(p.tid) === tid)) return;
  list.push({ tid, tname, added_at: new Date().toISOString() });
  $persistentStore.write(JSON.stringify(list), PART_BLACKLIST_KEY);
  $notification.post("哔哩哔哩黑名单", "已将分区加入黑名单", tname || `TID: ${tid}`);
}

(function main() {
  const url      = $request.url || "";
  const queryStr = url.includes("?") ? url.split("?")[1] : "";
  const bodyStr  = $request.body || "";

  const params    = Object.assign({}, parseKV(queryStr), parseKV(bodyStr));
  const reasonId  = String(params.reason_id || "");
  const contentId = String(params.id        || "");

  // 非目标 reason → 放行
  if (!["3", "4", "1001", "1002"].includes(reasonId)) {
    return $done({});
  }

  // 名称查取：extend > meta_map > 请求参数
  const extend  = tryJSON(params.extend);
  const metaMap = tryJSON($persistentStore.read(META_MAP_KEY));
  const meta    = metaMap[contentId] || {};

  // ── A. 原生 UP（reason_id=4）────────────────────────────────
  if (reasonId === "4") {
    const upId   = String(meta.up_id || params.mid || params.up_id || "");
    const upName = meta.up_name || params.uname || "";
    if (upId) addToUpBlacklist(upId, upName, "dislike");
    return $done({});   // 放行至 B站服务器
  }

  // ── A. 原生分区（reason_id=3）───────────────────────────────
  if (reasonId === "3") {
    const tid   = String(meta.tid || params.tid || "");
    const tname = meta.tname || params.tname || "";
    if (tid) addToPartBlacklist(tid, tname);
    return $done({});   // 放行至 B站服务器
  }

  // ── B. 注入 UP（reason_id=1001）────────────────────────────
  if (reasonId === "1001") {
    const upId   = String(extend.up_id   || meta.up_id   || params.mid || "");
    const upName =        extend.up_name || meta.up_name || "";
    if (upId) addToUpBlacklist(upId, upName, "three_point");
    return mockSuccess();   // 不转发 B站，避免未知 reason_id 报错
  }

  // ── B. 注入分区（reason_id=1002）───────────────────────────
  if (reasonId === "1002") {
    const tid   = String(extend.tid   || meta.tid   || params.tid || "");
    const tname =        extend.tname || meta.tname || "";
    if (tid) addToPartBlacklist(tid, tname);
    return mockSuccess();
  }
})();
