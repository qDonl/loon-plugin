/**
 * 清空黑名单 (通过 Loon 脚本手动触发)
 * 在 Loon → 脚本 → 手动运行 中执行
 */

const BLACKLIST_KEY = "rednot_blacklist";

const raw = $persistentStore.read(BLACKLIST_KEY);
const blacklist = raw ? JSON.parse(raw) : [];
const count = blacklist.length;

$persistentStore.write(JSON.stringify([]), BLACKLIST_KEY);
$notification.post("小红书黑名单", `✅ 已清空 ${count} 条黑名单记录`, "");
$done({});
