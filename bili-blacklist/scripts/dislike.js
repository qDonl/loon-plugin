/**
 * B站「不感兴趣」拦截
 * 拦截: https://app.bilibili.com/x/feed/dislike (http-request, GET)
 *
 * UP 名称获取策略（按优先级）：
 *   1. metaMap[avid].up_name      — 精确命中（filter.js 写入）
 *   2. upNameMap[up_id]           — 近 10 次刷新缓存
 *   3. 扫描整个 metaMap            — 近 300 条视频里同 UP 任意一条
 *   4. 调用 B站公开 API            — 以上均失败时兜底（异步）
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
  // 已存在则更新名称（如果之前名称为空）
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

function findNameLocally(upId, meta, upNameMap, metaMap) {
  return meta.up_name
    || upNameMap[upId]
    || (Object.values(metaMap).find(e => String(e.up_id) === upId && e.up_name) || {}).up_name
    || "";
}

function fetchUpNameThenDone(upId, source, doneAction) {
  $httpClient.get({
    url: `https://api.bilibili.com/x/space/acc/info?mid=${upId}`,
    timeout: 5000,
  }, function(err, _resp, data) {
    let name = "";
    if (!err && data) {
      try { name = (JSON.parse(data).data || {}).name || ""; } catch (_) {}
    }
    addToUpBlacklist(upId, name, source);
    doneAction();
  });
}

(function main() {
  const url      = $request.url || "";
  const queryStr = url.includes("?") ? url.split("?")[1] : "";
  const params   = parseKV(queryStr);

  const reasonId = parseInt((params.reason_ids || "").split("#")[0], 10);
  const avid     = params.id  || "";
  const upMid    = params.mid || "";

  const metaMap   = JSON.parse($persistentStore.read(META_MAP_KEY)    || "{}");
  const upNameMap = JSON.parse($persistentStore.read(UP_NAME_MAP_KEY) || "{}");
  const meta      = metaMap[String(avid)] || {};

  // ── UP 主黑名单 ────────────────────────────────────────────────
  if (reasonId === 4 || reasonId === 1001) {
    const upId   = upMid || String(meta.up_id || "");
    if (!upId) return reasonId === 1001 ? mockSuccess() : $done({});

    const upName = findNameLocally(upId, meta, upNameMap, metaMap);

    if (upName) {
      // 本地找到名称，同步处理
      addToUpBlacklist(upId, upName, "dislike");
      return reasonId === 1001 ? mockSuccess() : $done({});
    }

    // 本地没有名称，异步调 B站 API
    const doneAction = reasonId === 1001
      ? () => $done({ response: { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: 0, message: "OK", ttl: 1 }) } })
      : () => $done({});
    return fetchUpNameThenDone(upId, "dislike", doneAction);
  }

  // ── 分区黑名单 ─────────────────────────────────────────────────
  if (reasonId === 3 || reasonId === 1002) {
    const tid   = String(meta.tid || "");
    const tname = meta.tname || "";
    if (tid) addToPartBlacklist(tid, tname);
    return reasonId === 1002 ? mockSuccess() : $done({});
  }

  $done({});

  function mockSuccess() {
    $done({ response: { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: 0, message: "OK", ttl: 1 }) } });
  }
})();
