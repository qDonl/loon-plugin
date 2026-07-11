/**
 * B站「不感兴趣」拦截
 * 拦截: https://app.bilibili.com/x/feed/dislike (http-request, GET)
 *
 * UP 名称查找顺序：
 *   1. metaMap[avid].up_name      — 精确命中当前视频（avid 由 dislike URL 的 id 参数提供）
 *   2. nameCache[up_id]           — filter.js 持久化的 UP 名称缓存（最多 50 条）
 *   3. 扫描 metaMap               — 近 300 条视频里同 UP 的任意一条
 *
 * reason_id 处理:
 *   4    → UP 黑名单，放行至 B站
 *   3    → 分区黑名单，放行至 B站
 *   1001 → UP 黑名单（注入菜单），返回 mock 200
 *   1002 → 分区黑名单（注入菜单），返回 mock 200
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";
const META_MAP_KEY       = "bili_aid_meta_map";
const UP_NAME_CACHE_KEY  = "bili_up_name_cache";

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

function addToUpBlacklist(upId, upName, source) {
  const list = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY) || "[]");
  const existing = list.find(u => String(u.up_id) === upId);
  if (existing) {
    if (!existing.up_name && upName) {
      existing.up_name = upName;
      $persistentStore.write(JSON.stringify(list), UP_BLACKLIST_KEY);
    }
    return;
  }
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

function mockSuccess() {
  $done({
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
  const params   = parseKV(queryStr);

  const reasonId = parseInt((params.reason_ids || "").split("#")[0], 10);
  const avid     = params.id  || "";
  const upMid    = params.mid || "";

  const metaMap  = JSON.parse($persistentStore.read(META_MAP_KEY)     || "{}");
  const nameCache= JSON.parse($persistentStore.read(UP_NAME_CACHE_KEY) || "[]");
  const meta     = metaMap[String(avid)] || {};

  // ── UP 主黑名单 ────────────────────────────────────────────────
  if (reasonId === 4 || reasonId === 1001) {
    const upId = upMid || String(meta.up_id || "");
    if (!upId) return reasonId === 1001 ? mockSuccess() : $done({});

    // 三级查找：metaMap 精确命中 → 名称缓存 → metaMap 扫描
    const upName = meta.up_name
      || (nameCache.find(e => e.up_id === upId) || {}).up_name
      || (Object.values(metaMap).find(e => String(e.up_id) === upId && e.up_name) || {}).up_name
      || "";

    addToUpBlacklist(upId, upName, "dislike");
    return reasonId === 1001 ? mockSuccess() : $done({});
  }

  // ── 分区黑名单 ─────────────────────────────────────────────────
  if (reasonId === 3 || reasonId === 1002) {
    const tid   = String(meta.tid   || "");
    const tname = meta.tname || "";
    if (tid) addToPartBlacklist(tid, tname);
    return reasonId === 1002 ? mockSuccess() : $done({});
  }

  $done({});
})();
