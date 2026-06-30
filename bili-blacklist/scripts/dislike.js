/**
 * B站「不感兴趣」拦截
 * 拦截: https://app.bilibili.com/x/feed/dislike (http-request, GET)
 *
 * 关键参数:
 *   reason_ids  格式为 "{reasonId}#{subId}"，URL 编码后如 "4%231"
 *               4 = 不感兴趣：UP主  |  3 = 不感兴趣：频道
 *   mid         UP 主 UID
 *   id          视频 avid，用于从 meta_map 查询 UP 名称和分区信息
 *
 * 处理逻辑:
 *   · reason_id 4  → 将 UP 加入黑名单，放行请求至 B站
 *   · reason_id 3  → 将分区加入黑名单，放行请求至 B站
 *   · reason_id 1001 (注入菜单) → 将 UP 加入黑名单，返回 mock 200（不转发）
 *   · reason_id 1002 (注入菜单) → 将分区加入黑名单，返回 mock 200（不转发）
 *   · 其他         → 直接放行
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";
const META_MAP_KEY       = "bili_aid_meta_map";
const UP_NAME_MAP_KEY    = "bili_up_name_map";

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

  // reason_ids 格式: "4#1"（URL 解码后），取 # 前的数字作为主 reason_id
  const reasonId = parseInt((params.reason_ids || "").split("#")[0], 10);

  const avid  = params.id  || "";
  const upMid = params.mid || "";

  const metaMap   = JSON.parse($persistentStore.read(META_MAP_KEY)    || "{}");
  const upNameMap = JSON.parse($persistentStore.read(UP_NAME_MAP_KEY) || "{}");
  const meta      = metaMap[String(avid)] || {};

  // 调试：确认参数和名称查找结果
  $notification.post(
    "bili [调试] dislike 参数",
    `avid=${avid} mid=${upMid} reasonId=${reasonId}`,
    `metaHit=${!!meta.up_name} nameMapHit=${!!upNameMap[upMid]} metaScanKeys=${Object.keys(metaMap).length}`
  );

  // ── UP 主黑名单 ────────────────────────────────────────────────
  if (reasonId === 4 || reasonId === 1001) {
    const upId = upMid || String(meta.up_id || "");
    // 三级查找：① avid 精确查 metaMap ② upNameMap（近10次刷新）③ 扫描整个 metaMap
    const upName = meta.up_name
      || upNameMap[upId]
      || (Object.values(metaMap).find(e => String(e.up_id) === upId && e.up_name) || {}).up_name
      || "";
    if (upId) addToUpBlacklist(upId, upName, "dislike");
    if (reasonId === 1001) return mockSuccess();
  }

  // ── 分区黑名单 ─────────────────────────────────────────────────
  if (reasonId === 3 || reasonId === 1002) {
    const tid   = String(meta.tid || "");
    const tname = meta.tname || "";
    if (tid) addToPartBlacklist(tid, tname);
    if (reasonId === 1002) return mockSuccess();
  }

  $done({}); // 放行至 B站服务器
})();
