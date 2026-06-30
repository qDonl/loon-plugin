/**
 * B站「不感兴趣」拦截器
 * 拦截: https://app.bilibili.com/x/feed/dislike (http-request)
 *
 * 处理两类 reason_id：
 *
 *  reason_id=1001  由 filter.js 注入的「🚫 屏蔽UP」菜单项触发
 *                  → 将该 UP 加入 bili_up_blacklist
 *                  → 返回 mock 200，请求不转发到 B站服务器
 *
 *  reason_id=1002  由 filter.js 注入的「🚫 屏蔽分区」菜单项触发
 *                  → 将该分区加入 bili_partition_blacklist
 *                  → 返回 mock 200，请求不转发到 B站服务器
 *
 *  其他 reason_id  B站原生「不感兴趣」（如推荐过、内容质量差等）
 *                  → 直接放行，正常上报给 B站服务器
 *
 * UP 名称 / 分区名称的查取顺序：
 *   1. 请求体中 reason 条目携带的 extend 字段（JSON）
 *   2. filter.js 维护的 bili_aid_meta_map（以内容 avid 为键）
 *   3. 以 ID 兜底存储（管理页仍可显示并移除）
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";
const META_MAP_KEY       = "bili_aid_meta_map";

const REASON_ID_UP   = "1001";
const REASON_ID_PART = "1002";

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

function tryParseJSON(str) {
  try { return JSON.parse(str || "{}"); } catch (_) { return {}; }
}

// 拦截自定义 reason 时返回 mock 成功，不转发给 B站服务器
function mockSuccess() {
  return $done({
    response: {
      status:  200,
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code: 0, message: "OK", ttl: 1 }),
    },
  });
}

(function main() {
  const url      = $request.url || "";
  const queryStr = url.includes("?") ? url.split("?")[1] : "";
  const bodyStr  = $request.body || "";

  // URL query 和 body 参数合并，body 优先
  const params = Object.assign({}, parseKV(queryStr), parseKV(bodyStr));

  const reasonId  = String(params.reason_id || "");
  const contentId = String(params.id        || "");

  // 非自定义 reason → 放行
  if (reasonId !== REASON_ID_UP && reasonId !== REASON_ID_PART) {
    return $done({});
  }

  // 查取 meta：优先 extend，其次 meta_map
  const extendData = tryParseJSON(params.extend);
  const metaMap    = tryParseJSON($persistentStore.read(META_MAP_KEY));
  const meta       = metaMap[contentId] || {};

  if (reasonId === REASON_ID_UP) {
    const upId   = String(extendData.up_id   || meta.up_id   || params.mid || params.up_id || "");
    const upName =        extendData.up_name || meta.up_name || "";
    if (!upId) return mockSuccess();

    const list = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY) || "[]");
    if (!list.some(u => String(u.up_id) === upId)) {
      list.push({
        up_id:    upId,
        up_name:  upName,
        source:   "three_point",
        added_at: new Date().toISOString(),
      });
      $persistentStore.write(JSON.stringify(list), UP_BLACKLIST_KEY);
    }
    $notification.post("哔哩哔哩黑名单", "已将 UP 加入黑名单", upName || `UID: ${upId}`);
    return mockSuccess();
  }

  if (reasonId === REASON_ID_PART) {
    const tid   = String(extendData.tid   || meta.tid   || params.tid || "");
    const tname =        extendData.tname || meta.tname || params.tname || "";
    if (!tid) return mockSuccess();

    const list = JSON.parse($persistentStore.read(PART_BLACKLIST_KEY) || "[]");
    if (!list.some(p => String(p.tid) === tid)) {
      list.push({
        tid:      tid,
        tname:    tname,
        added_at: new Date().toISOString(),
      });
      $persistentStore.write(JSON.stringify(list), PART_BLACKLIST_KEY);
    }
    $notification.post("哔哩哔哩黑名单", "已将分区加入黑名单", tname || `TID: ${tid}`);
    return mockSuccess();
  }
})();
