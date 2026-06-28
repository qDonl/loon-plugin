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

  // 解析 form-urlencoded
  const params = {};
  body.split("&").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = decodeURIComponent(pair.slice(0, idx));
    const v = decodeURIComponent(pair.slice(idx + 1));
    params[k] = v;
  });

  const authorId = params.note_author_id;
  const noteId   = params.note_id;

  if (!authorId) return $done({});

  // 尝试从 mapping 里拿昵称（有则更好，没有也无所谓）
  const mapRaw  = $persistentStore.read(NOTE_MAP_KEY);
  const noteMap = mapRaw ? JSON.parse(mapRaw) : {};
  const nickname = noteMap[noteId]?.nickname || "";

  // 写黑名单
  const raw = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];

  if (blacklist.some(u => u.user_id === authorId)) {
    // 已在黑名单，静默放行
    return $done({});
  }

  blacklist.push({
    user_id:  authorId,
    nickname: nickname,
    added_at: new Date().toISOString(),
  });
  $persistentStore.write(JSON.stringify(blacklist), BLACKLIST_KEY);

  $notification.post(
    "小红书黑名单",
    `✅ 已屏蔽${nickname ? `「${nickname}」` : ` ${authorId}`}`,
    `黑名单共 ${blacklist.length} 人`
  );

  $done({});  // 放行，XHS 正常处理「不感兴趣」
})();
