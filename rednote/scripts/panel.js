/**
 * Loon Panel: 小红书黑名单总览
 * 按来源分组展示黑名单，并提示手动配置入口
 */

const BLACKLIST_KEY = "rednot_blacklist";

const SOURCE_LABEL = {
  manual:  "⌨️ 手动配置",
  dislike: "👎 不感兴趣",
  detail:  "🔘 详情页按钮",
};

(function main() {
  const raw       = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];

  if (blacklist.length === 0) {
    return $done({
      title:       "小红书黑名单 · 空",
      content:     "暂无屏蔽记录\n\n添加方式：\n· 列表页长按 → 不感兴趣\n· 笔记详情页悬浮按钮\n· 插件配置页手动输入用户ID",
      icon:        "person.crop.circle.badge.minus",
      "icon-color": "#ff2d55",
    });
  }

  /* ── 按来源分组 ── */
  const groups = {};
  blacklist.forEach(u => {
    const src = u.source || "dislike";
    if (!groups[src]) groups[src] = [];
    groups[src].push(u);
  });

  /* ── 构建展示内容 ── */
  const lines = [`共屏蔽 ${blacklist.length} 人`];

  const order = ["manual", "dislike", "detail"];
  // 兜底：处理不在 order 里的未知来源
  Object.keys(groups).forEach(src => { if (!order.includes(src)) order.push(src); });

  order.forEach(src => {
    const group = groups[src];
    if (!group?.length) return;

    const label = SOURCE_LABEL[src] || src;
    lines.push(`\n${label} · ${group.length} 人`);

    // 每组最多显示 5 条，最新在前
    group.slice(-5).reverse().forEach(u => {
      const name = u.nickname || (u.user_id.slice(0, 12) + "…");
      lines.push(`  · ${name}`);
    });
    if (group.length > 5) lines.push(`  … 另有 ${group.length - 5} 条`);
  });

  lines.push("\n——\n管理页：Safari 打开 http://rednot.manage\n手动添加：插件配置 → 手动黑名单用户ID");

  $done({
    title:       `小红书黑名单 · ${blacklist.length} 人`,
    content:     lines.join("\n"),
    icon:        "person.crop.circle.badge.minus",
    "icon-color": "#ff2d55",
  });
})();
