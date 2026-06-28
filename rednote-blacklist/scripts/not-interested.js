/**
 * 拦截「不感兴趣」请求 → 同步加入黑名单
 * 拦截: POST edith.xiaohongshu.com/api/sns/v1/content/dislike/report  (http-request)
 *
 * 请求体（form-urlencoded）直接包含 note_author_id，无需 mapping 查询。
 * 脚本写入黑名单后放行原请求，XHS 推荐算法照常收到「不感兴趣」信号。
 */

const BLACKLIST_KEY = "rednot_blacklist";
const NOTE_MAP_KEY  = "rednot_note_user_map";

(function main() {
  const body = $request.body || "";

  const params = {};
  body.split("&").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
  });

  const authorId = params.note_author_id;
  const noteId   = params.note_id;
  if (!authorId) return $done({});

  const mapRaw  = $persistentStore.read(NOTE_MAP_KEY);
  const noteMap = mapRaw ? JSON.parse(mapRaw) : {};
  const nickname = noteMap[noteId]?.nickname || "";

  const raw       = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];

  if (blacklist.some(u => u.user_id === authorId)) return $done({});

  blacklist.push({
    user_id:  authorId,
    nickname: nickname,
    source:   "dislike",
    added_at: new Date().toISOString(),
  });
  $persistentStore.write(JSON.stringify(blacklist), BLACKLIST_KEY);

  $notification.post(
    "小红书黑名单",
    `✅ 已屏蔽${nickname ? `「${nickname}」` : ` ${authorId.slice(0, 12)}...`}`,
    `黑名单共 ${blacklist.length} 人`
  );

  $done({});
})();
