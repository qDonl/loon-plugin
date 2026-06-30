/**
 * B站「不感兴趣」拦截器
 * 拦截: https://app.bilibili.com/x/feed/dislike (http-request)
 *
 * 功能:
 *  - reason_id=4 (UP主)  → 将该 UP 加入黑名单
 *  - reason_id=3 (频道)  → 将该分区加入黑名单
 *
 * UP 名称 / 分区名称从 filter.js 维护的 meta 映射中查取，
 * 映射缺失时以 ID 兜底存储，管理页依然可以显示并删除。
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

(function main() {
  const url      = $request.url || "";
  const queryStr = url.includes("?") ? url.split("?")[1] : "";
  const bodyStr  = $request.body || "";

  // URL query 和 body 参数合并，body 优先
  const params = Object.assign({}, parseKV(queryStr), parseKV(bodyStr));

  const reasonId  = String(params.reason_id || "");
  const contentId = String(params.id || "");

  const metaMap = JSON.parse($persistentStore.read(META_MAP_KEY) || "{}");
  const meta    = metaMap[contentId] || {};

  if (reasonId === "4") {
    // UP主加入黑名单
    const upId   = String(params.mid || params.up_id || meta.up_id || "");
    const upName = meta.up_name || params.uname || "";
    if (!upId) return $done({});

    const list = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY) || "[]");
    if (!list.some(u => String(u.up_id) === upId)) {
      list.push({
        up_id:    upId,
        up_name:  upName,
        source:   "dislike",
        added_at: new Date().toISOString(),
      });
      $persistentStore.write(JSON.stringify(list), UP_BLACKLIST_KEY);
      $notification.post("哔哩哔哩黑名单", "已将 UP 加入黑名单", upName || `UID: ${upId}`);
    }

  } else if (reasonId === "3") {
    // 分区加入黑名单
    const tid   = String(params.tid || meta.tid || "");
    const tname = meta.tname || params.tname || "";
    if (!tid) return $done({});

    const list = JSON.parse($persistentStore.read(PART_BLACKLIST_KEY) || "[]");
    if (!list.some(p => String(p.tid) === tid)) {
      list.push({
        tid:      tid,
        tname:    tname,
        added_at: new Date().toISOString(),
      });
      $persistentStore.write(JSON.stringify(list), PART_BLACKLIST_KEY);
      $notification.post("哔哩哔哩黑名单", "已将分区加入黑名单", tname || `TID: ${tid}`);
    }
  }

  $done({});
})();
