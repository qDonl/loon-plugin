/**
 * 小红书推荐流黑名单过滤
 * 拦截: https://rec.xiaohongshu.com/api/sns/v*/homefeed (http-response)
 *
 * 职责:
 *  1. 从 $argument 读取手动配置的用户 ID，合并写入持久化存储
 *  2. 建立 note_id -> user_id 映射
 *  3. 过滤黑名单用户的推荐内容
 */

const BLACKLIST_KEY  = "rednot_blacklist";
const NOTE_MAP_KEY   = "rednot_note_user_map";
const NOTE_MAP_MAX   = 600;

/* ── 解析插件 $argument，返回手动配置的用户 ID 列表 ── */
function parseManualIds() {
  const argStr = $argument || "";
  if (!argStr) return [];
  // $argument 格式: "manual_blacklist=id1%2Cid2%2Cid3"
  const match = argStr.match(/(?:^|&)manual_blacklist=([^&]*)/);
  const raw   = match ? decodeURIComponent(match[1]) : argStr;
  return raw.split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 8);
}

/* ── 将 $argument 中的手动 ID 合并进持久化黑名单 ── */
function mergeManualIds(blacklist) {
  const ids = parseManualIds();
  if (!ids.length) return false;
  let changed = false;
  ids.forEach(userId => {
    if (!blacklist.some(u => u.user_id === userId)) {
      blacklist.push({
        user_id:  userId,
        nickname: "",
        source:   "manual",
        added_at: new Date().toISOString(),
      });
      changed = true;
    }
  });
  return changed;
}

(function main() {
  const rawBody = $response.body;
  if (!rawBody) return $done({});

  let data;
  try { data = JSON.parse(rawBody); } catch (_) { return $done({}); }

  const items = data?.data?.items;
  if (!Array.isArray(items)) return $done({});

  /* ── 读取黑名单并合并手动配置 ── */
  const blacklistRaw = $persistentStore.read(BLACKLIST_KEY);
  const blacklist    = blacklistRaw ? JSON.parse(blacklistRaw) : [];
  const manualChanged = mergeManualIds(blacklist);
  if (manualChanged) $persistentStore.write(JSON.stringify(blacklist), BLACKLIST_KEY);

  const blockedIds = new Set(blacklist.map(u => u.user_id));

  /* ── 建立 note_id -> user 映射 ── */
  const mapRaw = $persistentStore.read(NOTE_MAP_KEY);
  const noteMap = mapRaw ? JSON.parse(mapRaw) : {};

  items.forEach(item => {
    const noteId = item.id;
    const user   = item?.note_card?.user;
    if (noteId && user?.user_id) {
      noteMap[noteId] = {
        user_id:  user.user_id,
        nickname: user.nick_name || user.nickname || "",
      };
    }
  });

  const keys = Object.keys(noteMap);
  if (keys.length > NOTE_MAP_MAX)
    keys.slice(0, keys.length - NOTE_MAP_MAX).forEach(k => delete noteMap[k]);
  $persistentStore.write(JSON.stringify(noteMap), NOTE_MAP_KEY);

  /* ── 过滤黑名单用户 ── */
  const before = items.length;
  data.data.items = items.filter(item => {
    const uid = item?.note_card?.user?.user_id;
    return !uid || !blockedIds.has(uid);
  });
  const removed = before - data.data.items.length;

  if (removed > 0) {
    $notification.post("小红书", `已过滤 ${removed} 条黑名单内容`, `黑名单共 ${blacklist.length} 人`);
  }

  $done({ body: JSON.stringify(data) });
})();
