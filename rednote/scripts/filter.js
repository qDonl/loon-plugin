/**
 * 小红书推荐流黑名单过滤
 * 拦截: https://rec.xiaohongshu.com/api/sns/v6/homefeed (response)
 *
 * 职责:
 *  1. 从持久化存储读取黑名单
 *  2. 解析响应, 建立 note_id -> user_id 映射供 add-blacklist.js 使用
 *  3. 过滤掉黑名单用户的条目
 */

const BLACKLIST_KEY = "rednot_blacklist";
const NOTE_MAP_KEY = "rednot_note_user_map";
const NOTE_MAP_MAX = 600; // 保留最近 600 条 note 映射

(function main() {
  const rawBody = $response.body;
  if (!rawBody) return $done({});

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (_) {
    return $done({});
  }

  const items = data?.data?.items;
  if (!Array.isArray(items)) return $done({});

  // --- 黑名单 ---
  const blacklistRaw = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = blacklistRaw ? JSON.parse(blacklistRaw) : [];
  const blockedIds = new Set(blacklist.map((u) => u.user_id));

  // --- note_id -> user 映射 (供 add-blacklist.js 查询) ---
  const mapRaw = $persistentStore.read(NOTE_MAP_KEY);
  const noteMap = mapRaw ? JSON.parse(mapRaw) : {};

  items.forEach((item) => {
    const noteId = item.id;
    const user = item?.note_card?.user;
    if (noteId && user?.user_id) {
      noteMap[noteId] = {
        user_id: user.user_id,
        nickname: user.nick_name || user.nickname || "",
      };
    }
  });

  // 防止 map 无限增长
  const keys = Object.keys(noteMap);
  if (keys.length > NOTE_MAP_MAX) {
    keys.slice(0, keys.length - NOTE_MAP_MAX).forEach((k) => delete noteMap[k]);
  }
  $persistentStore.write(JSON.stringify(noteMap), NOTE_MAP_KEY);

  // --- 过滤 ---
  const before = items.length;
  data.data.items = items.filter((item) => {
    const uid = item?.note_card?.user?.user_id;
    return !uid || !blockedIds.has(uid);
  });
  const removed = before - data.data.items.length;

  if (removed > 0) {
    $notification.post("小红书", `已屏蔽 ${removed} 条黑名单内容`, `当前黑名单共 ${blacklist.length} 人`);
  }

  $done({ body: JSON.stringify(data) });
})();
