/**
 * Loon Panel: B站黑名单总览
 */

const UP_BLACKLIST_KEY   = "bili_up_blacklist";
const PART_BLACKLIST_KEY = "bili_partition_blacklist";

(function main() {
  const upList   = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY)   || "[]");
  const partList = JSON.parse($persistentStore.read(PART_BLACKLIST_KEY) || "[]");

  if (upList.length === 0 && partList.length === 0) {
    return $done({
      title:        "B站黑名单 · 空",
      content:      "暂无屏蔽记录\n\n添加方式：\n· 首页长按视频 → 不感兴趣 → UP主：xxx\n· 首页长按视频 → 不感兴趣 → 频道：xxx\n\n管理页：http://bili.blacklist",
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

  lines.push("\n——\n管理页：http://bili.blacklist\n（或插件详情页点「主页」直接跳转）");

  $done({
    title:        `B站黑名单 · UP ${upList.length} / 分区 ${partList.length}`,
    content:      lines.join("\n"),
    icon:         "video.slash",
    "icon-color": "#fb7299",
  });
})();
