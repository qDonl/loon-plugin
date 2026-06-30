/**
 * B站首页推荐流过滤
 * 拦截: https://app.bilibili.com/x/v2/feed/index (http-response)
 *
 * 功能:
 *  1. 过滤非普通视频内容（直播、广告）
 *  2. 过滤黑名单 UP 主的视频
 *  3. 过滤黑名单分区的视频
 *  4. 维护 aid -> meta 映射，供 dislike.js 查询 UP 名称/分区名称
 *  5. 向每张视频卡片的三点菜单注入「屏蔽UP」「屏蔽分区」选项
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";
const META_MAP_KEY       = "bili_aid_meta_map";
const META_MAP_MAX       = 300;

// 自定义 reason_id，避免与 B站原生 id 冲突
const REASON_ID_UP   = 1001;
const REASON_ID_PART = 1002;

/**
 * 向单张卡片的三点菜单注入黑名单选项
 * 同时写入 three_point.dislike_reasons 和 three_point_v2[dislike].reasons，
 * 兼容 B站不同版本的菜单渲染逻辑。
 */
function injectBlacklistReasons(item) {
  const args   = item.args || {};
  const upId   = String(args.up_id  || "");
  const upName = args.up_name  || "";
  const tid    = String(args.tid    || "");
  const tname  = args.tname   || "";

  if (!upId && !tid) return;

  // 注入的 reason 条目
  // extend 字段存储结构化数据，dislike.js 从请求体中尝试读取；
  // 即使 B站客户端不上报 extend，dislike.js 也会从 meta_map 兜底查取。
  const upReason = upId ? {
    id:     REASON_ID_UP,
    name:   `🚫 屏蔽 UP：${upName || upId}`,
    toast:  "已加入UP黑名单，下次刷新生效",
    extend: JSON.stringify({ up_id: upId, up_name: upName }),
  } : null;

  const partReason = tid ? {
    id:     REASON_ID_PART,
    name:   `🚫 屏蔽分区：${tname || tid}`,
    toast:  "已加入分区黑名单，下次刷新生效",
    extend: JSON.stringify({ tid, tname }),
  } : null;

  // ── three_point.dislike_reasons（旧格式） ──────────────────
  if (item.three_point && Array.isArray(item.three_point.dislike_reasons)) {
    if (upReason)   item.three_point.dislike_reasons.unshift(upReason);
    if (partReason) item.three_point.dislike_reasons.unshift(partReason);
  }

  // ── three_point_v2[type=dislike].reasons（新格式） ──────────
  if (Array.isArray(item.three_point_v2)) {
    const dislikeEntry = item.three_point_v2.find(e => e.type === "dislike");
    if (dislikeEntry && Array.isArray(dislikeEntry.reasons)) {
      if (upReason)   dislikeEntry.reasons.unshift(upReason);
      if (partReason) dislikeEntry.reasons.unshift(partReason);
    }
  }
}

(function main() {
  const rawBody = $response.body;
  if (!rawBody) return $done({});

  let data;
  try { data = JSON.parse(rawBody); } catch (_) { return $done({}); }

  const items = data?.data?.items;
  if (!Array.isArray(items)) return $done({});

  // 读取黑名单
  const upBlacklist   = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY)   || "[]");
  const partBlacklist = JSON.parse($persistentStore.read(PART_BLACKLIST_KEY) || "[]");

  const blockedUps   = new Set(upBlacklist.map(u => String(u.up_id)));
  const blockedParts = new Set(partBlacklist.map(p => String(p.tid)));

  // 维护 aid -> meta 映射
  const metaMap = JSON.parse($persistentStore.read(META_MAP_KEY) || "{}");

  items.forEach(item => {
    const aid  = String(item.param || "");
    const args = item.args || {};
    if (aid && args.up_id) {
      metaMap[aid] = {
        up_id:  String(args.up_id),
        up_name: args.up_name || "",
        tid:    String(args.tid  || ""),
        tname:  args.tname || "",
      };
    }
  });

  const mapKeys = Object.keys(metaMap);
  if (mapKeys.length > META_MAP_MAX) {
    mapKeys.slice(0, mapKeys.length - META_MAP_MAX).forEach(k => delete metaMap[k]);
  }
  $persistentStore.write(JSON.stringify(metaMap), META_MAP_KEY);

  // 过滤 + 注入
  const total = items.length;
  let adCount = 0, liveCount = 0, upCount = 0, partCount = 0;

  data.data.items = items.filter(item => {
    // 广告
    if (item.card_type === "cm_v2" || item.card_goto === "ad_av") {
      adCount++;
      return false;
    }
    // 直播
    if (item.goto === "live" || item.goto === "live_room") {
      liveCount++;
      return false;
    }
    // 只保留普通视频
    if (item.goto !== "av") return false;

    const args = item.args || {};
    const upId = String(args.up_id || "");
    const tid  = String(args.tid   || "");

    if (upId && blockedUps.has(upId))   { upCount++;   return false; }
    if (tid  && blockedParts.has(tid))  { partCount++; return false; }

    // 向通过过滤的卡片注入黑名单菜单项
    injectBlacklistReasons(item);

    return true;
  });

  const removed = total - data.data.items.length;
  if (removed > 0) {
    const parts = [];
    if (adCount)   parts.push(`广告 ${adCount}`);
    if (liveCount) parts.push(`直播 ${liveCount}`);
    if (upCount)   parts.push(`黑名单UP ${upCount}`);
    if (partCount) parts.push(`黑名单分区 ${partCount}`);
    $notification.post("哔哩哔哩", `已过滤 ${removed} 条内容`, parts.join(" / "));
  }

  $done({ body: JSON.stringify(data) });
})();
