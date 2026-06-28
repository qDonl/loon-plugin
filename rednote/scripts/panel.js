/**
 * Loon Panel: 小红书黑名单管理
 * 显示黑名单条数和最近添加的用户
 */

const BLACKLIST_KEY = "rednot_blacklist";

(function main() {
  const raw = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];

  if (blacklist.length === 0) {
    return $done({
      title: "小红书黑名单",
      content: "黑名单为空\n长按笔记 → 不感兴趣 → 自动屏蔽作者",
      icon: "person.crop.circle.badge.minus",
      "icon-color": "#ff2d55",
    });
  }

  // 最近 5 条
  const recent = blacklist
    .slice(-5)
    .reverse()
    .map((u) => `· ${u.nickname || u.user_id}`)
    .join("\n");

  $done({
    title: `小红书黑名单 · ${blacklist.length} 人`,
    content: `最近屏蔽:\n${recent}`,
    icon: "person.crop.circle.badge.minus",
    "icon-color": "#ff2d55",
  });
})();
