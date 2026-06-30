/**
 * B站「不感兴趣」参数提取
 * 拦截: https://app.bilibili.com/x/v2/feed/index (http-request)
 *
 * 「不感兴趣」操作没有独立接口，B站将 dislike 反馈参数打包进
 * 下一次 feed 刷新请求一起发送。本脚本拦截该请求，
 * 从请求 URL/body 中提取 dislike 相关参数并写入黑名单。
 *
 * 调试通知会打印所有参数名，用于定位 B站实际使用的 dislike 字段名。
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

  // 合并 URL query 和 body 参数
  const params = Object.assign({}, parseKV(queryStr), parseKV(bodyStr));

  // ── 调试：打印本次请求中与 dislike/feedback 相关的所有参数 ──────
  // 确认 dislike 信息在哪个字段后可删除此段
  const debugKeys = Object.keys(params).filter(k =>
    /dislike|not_interest|feedback|reason|rcmd_reason|goto|avid|aid/.test(k)
  );
  if (debugKeys.length > 0) {
    const info = debugKeys.map(k => `${k}=${String(params[k]).slice(0, 40)}`).join("\n");
    $notification.post("bili [调试] feed 请求参数", `共 ${debugKeys.length} 个相关参数`, info);
  }

  // ── 尝试已知的 dislike 参数格式 ─────────────────────────────────
  // 格式 A: dislike_avid + dislike_goto + dislike_mid + reason_id（猜测）
  const dislikeAvid   = params.dislike_avid || params.dislike_id || "";
  const dislikeMid    = params.dislike_mid  || params.mid        || "";
  const dislikeTid    = params.dislike_tid  || params.tid        || "";
  const reasonId      = params.reason_id    || params.dislike_reason_id || "";

  if (dislikeAvid) {
    const metaMap = JSON.parse($persistentStore.read(META_MAP_KEY) || "{}");
    const meta    = metaMap[String(dislikeAvid)] || {};

    if (reasonId === "4" || reasonId === "1001") {
      const upId   = String(dislikeMid || meta.up_id || "");
      const upName = meta.up_name || "";
      if (upId) addToUpBlacklist(upId, upName, "feed_request");
    }

    if (reasonId === "3" || reasonId === "1002") {
      const tid   = String(dislikeTid || meta.tid || "");
      const tname = meta.tname || "";
      if (tid) addToPartBlacklist(tid, tname);
    }
  }

  $done({});   // 始终放行，不影响 B站正常请求
})();
