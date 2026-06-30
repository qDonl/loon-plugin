/**
 * B站首页推荐流过滤
 * 拦截: https://app.bilibili.com/x/v2/feed/index (http-response)
 *
 * 功能:
 *  1. 过滤非普通视频内容（直播、广告）
 *  2. 过滤黑名单 UP 主的视频
 *  3. 过滤黑名单分区的视频
 *  4. 维护 aid -> meta 映射，供 dislike.js 查询 UP 名称/分区名称
 *  5. 向每张视频卡片注入「屏蔽UP」「屏蔽分区」自定义菜单项
 *
 * 注入说明：
 *  将自定义选项同时写入两处以兼容 B站不同版本的渲染逻辑：
 *    · three_point.dislike_reasons          (旧格式，v2/v3 使用)
 *    · three_point_v2[type=dislike].reasons (新格式，v4/v5 使用)
 *
 *  B站 App 对原生 reason_id（1/3/4/12/13）有硬编码的显示文案
 *  ("不感兴趣：UP" 等)。对于我们注入的 reason_id=1001/1002，
 *  App 可能有两种行为：
 *    a) 回退显示 name 字段 → 我们的按钮出现在菜单底部
 *    b) 忽略未知 id → 菜单无变化，原生拦截(reason_id=3/4)兜底
 *
 *  dislike.js 同时处理原生 id 和自定义 id，两条路都能写黑名单。
 */

const UP_BLACKLIST_KEY    = "bili_up_blacklist";
const PART_BLACKLIST_KEY  = "bili_partition_blacklist";
const META_MAP_KEY        = "bili_aid_meta_map";
const UP_NAME_MAP_KEY     = "bili_up_name_map";     // 合并后的平铺反查表，供 dislike.js 读取
const UP_NAME_BATCHES_KEY = "bili_up_name_batches"; // 最近 N 次刷新的批次数组
const META_MAP_MAX        = 300;
const NAME_BATCH_MAX      = 10;

const REASON_ID_UP   = 1001;
const REASON_ID_PART = 1002;

/**
 * 向单张视频卡片的两处三点菜单结构注入自定义黑名单选项。
 * extend 字段携带结构化数据，dislike.js 从中直接读取，
 * 免去 meta_map 查询的不确定性。
 */
function injectBlacklistReasons(item) {
  const args   = item.args || {};
  const upId   = String(args.up_id  || "");
  const upName = args.up_name || "";
  const tid    = String(args.tid    || "");
  const tname  = args.tname  || "";

  if (!upId && !tid) return;

  const upReason = upId ? {
    id:     REASON_ID_UP,
    name:   `加入UP黑名单：${upName || upId}`,
    toast:  "已加入UP黑名单，下次刷新生效",
    extend: JSON.stringify({ up_id: upId, up_name: upName }),
  } : null;

  const partReason = tid ? {
    id:     REASON_ID_PART,
    name:   `加入分区黑名单：${tname || tid}`,
    toast:  "已加入分区黑名单，下次刷新生效",
    extend: JSON.stringify({ tid, tname }),
  } : null;

  // ── 旧格式：three_point.dislike_reasons ──────────────────────
  if (item.three_point && Array.isArray(item.three_point.dislike_reasons)) {
    if (upReason)   item.three_point.dislike_reasons.unshift(upReason);
    if (partReason) item.three_point.dislike_reasons.unshift(partReason);
  }

  // ── 新格式：three_point_v2[type=dislike].reasons ─────────────
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

  // 维护 aid -> meta 映射（滚动累积，最多 300 条）
  const metaMap = JSON.parse($persistentStore.read(META_MAP_KEY) || "{}");
  // 本次刷新产生的 up_id → up_name 批次
  const currentBatch = {};

  items.forEach(item => {
    const aid  = String(item.param || "");
    const args = item.args || {};
    if (aid && args.up_id) {
      metaMap[aid] = {
        up_id:   String(args.up_id),
        up_name: args.up_name || "",
        tid:     String(args.tid   || ""),
        tname:   args.tname  || "",
      };
      if (args.up_name) currentBatch[String(args.up_id)] = args.up_name;
    }
  });

  const mapKeys = Object.keys(metaMap);
  if (mapKeys.length > META_MAP_MAX) {
    mapKeys.slice(0, mapKeys.length - META_MAP_MAX).forEach(k => delete metaMap[k]);
  }
  $persistentStore.write(JSON.stringify(metaMap), META_MAP_KEY);

  // 滚动批次：保留最近 NAME_BATCH_MAX 次刷新的数据
  const batches = JSON.parse($persistentStore.read(UP_NAME_BATCHES_KEY) || "[]");
  batches.unshift(currentBatch);
  if (batches.length > NAME_BATCH_MAX) batches.length = NAME_BATCH_MAX;
  // 将所有批次合并为平铺表（新批次覆盖旧批次的同名条目）
  const upNameMap = Object.assign({}, ...batches.slice().reverse());
  $persistentStore.write(JSON.stringify(batches),   UP_NAME_BATCHES_KEY);
  $persistentStore.write(JSON.stringify(upNameMap), UP_NAME_MAP_KEY);

  // 过滤 + 注入
  const total = items.length;
  let adCount = 0, liveCount = 0, upCount = 0, partCount = 0;

  data.data.items = items.filter(item => {
    if (item.card_type === "cm_v2" || item.card_goto === "ad_av") { adCount++;   return false; }
    if (item.goto === "live" || item.goto === "live_room")         { liveCount++; return false; }
    if (item.goto !== "av") return false;

    const args = item.args || {};
    const upId = String(args.up_id || "");
    const tid  = String(args.tid   || "");

    if (upId && blockedUps.has(upId))  { upCount++;   return false; }
    if (tid  && blockedParts.has(tid)) { partCount++; return false; }

    // 通过过滤的卡片注入自定义黑名单选项
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
