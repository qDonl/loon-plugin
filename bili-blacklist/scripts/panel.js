/**
 * Loon Panel: B站黑名单总览
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";
const SKIP_LAST_KEY      = "bili_skip_last";

const CATEGORY_LABEL = {
  sponsor:          "广告",
  selfpromo:        "推广",
  interaction:      "互动提醒",
  intro:            "片头",
  outro:            "片尾",
  preview:          "回顾/预告",
  music_offtopic:   "非正片音乐",
  poi_highlight:    "精彩时刻",
  filler:           "闲聊",
  exclusive_access: "抢先/独家",
};

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildSkipLines(skipLast) {
  if (!skipLast || !Array.isArray(skipLast.segments) || skipLast.segments.length === 0) return [];
  const lines = [`\n🛬 空降助手 · 最近命中`];
  lines.push(`  《${skipLast.title || "未知视频"}》`);
  skipLast.segments.slice(0, 5).forEach(seg => {
    lines.push(`  · ${fmtTime(seg.start)}-${fmtTime(seg.end)} ${CATEGORY_LABEL[seg.category] || seg.category}`);
  });
  if (skipLast.segments.length > 5) lines.push(`  … 另有 ${skipLast.segments.length - 5} 处`);
  return lines;
}

(function main() {
  const upList   = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY)   || "[]");
  const partList = JSON.parse($persistentStore.read(PART_BLACKLIST_KEY) || "[]");
  const skipLast = JSON.parse($persistentStore.read(SKIP_LAST_KEY)      || "null");
  const skipLines= buildSkipLines(skipLast);

  if (upList.length === 0 && partList.length === 0) {
    return $done({
      title:        "B站黑名单 · 空",
      content:      ["暂无屏蔽记录\n\n添加方式：\n· 首页长按视频 → 不感兴趣 → UP主：xxx\n· 首页长按视频 → 不感兴趣 → 频道：xxx\n\n管理页：http://bili.blacklist", ...skipLines].join("\n"),
      icon:         "video.slash",
      "icon-color": "#fb7299",
    });
  }

  const lines = [`UP黑名单 ${upList.length} 人 · 分区黑名单 ${partList.length} 个`];

  if (upList.length > 0) {
    lines.push("\n👤 UP 黑名单");
    [...upList].slice(-5).reverse().forEach(u => {
      lines.push(`  · ${u.up_name || ("UID: " + u.up_id)}`);
    });
    if (upList.length > 5) lines.push(`  … 另有 ${upList.length - 5} 位`);
  }

  if (partList.length > 0) {
    lines.push("\n📂 分区黑名单");
    [...partList].slice(-5).reverse().forEach(p => {
      lines.push(`  · ${p.tname || ("TID: " + p.tid)}`);
    });
    if (partList.length > 5) lines.push(`  … 另有 ${partList.length - 5} 个`);
  }

  lines.push(...skipLines);
  lines.push("\n——\n管理页：http://bili.blacklist\n（或插件详情页点「主页」直接跳转）");

  $done({
    title:        `B站黑名单 · UP ${upList.length} / 分区 ${partList.length}`,
    content:      lines.join("\n"),
    icon:         "video.slash",
    "icon-color": "#fb7299",
  });
})();
