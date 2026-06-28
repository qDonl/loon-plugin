/**
 * 拦截「不感兴趣」请求 → 同步加入黑名单
 * 拦截: POST edith.xiaohongshu.com/api/sns/*/note/not_interesting  (http-request)
 *
 * XHS 选中「不感兴趣」后向 edith.xiaohongshu.com 上报；
 * 本脚本拦截该请求，提取 note_id，查 note->user 映射，写入黑名单，然后放行原请求。
 */

const BLACKLIST_KEY = "rednot_blacklist";
const NOTE_MAP_KEY  = "rednot_note_user_map";

(function main() {
  const url  = $request.url  || "";
  const body = $request.body || "";

  // 解析请求体（JSON 或 form-urlencoded）
  let req = {};
  try {
    req = JSON.parse(body);
  } catch (_) {
    body.split("&").forEach(pair => {
      const [k, v] = pair.split("=");
      if (k) req[decodeURIComponent(k)] = decodeURIComponent(v || "");
    });
  }

  // 兼容多种字段名
  const noteId = req.note_id || req.noteId || req.id
    || new URLSearchParams(url.split("?")[1] || "").get("note_id")
    || "";

  if (!noteId) return $done({});  // 放行原请求

  // 查 note -> user 映射
  const mapRaw = $persistentStore.read(NOTE_MAP_KEY);
  const noteMap = mapRaw ? JSON.parse(mapRaw) : {};
  const userInfo = noteMap[noteId];

  if (!userInfo?.user_id) {
    // 映射里没有：说明这条笔记没在首页刷出来过，只记录一个通知
    $notification.post("小红书黑名单", "⚠️ 未找到作者信息", `note_id=${noteId}，请先在首页刷新一次`);
    return $done({});  // 放行
  }

  // 写黑名单
  const raw = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];
  const exists = blacklist.some(u => u.user_id === userInfo.user_id);

  if (!exists) {
    blacklist.push({
      user_id:  userInfo.user_id,
      nickname: userInfo.nickname,
      added_at: new Date().toISOString(),
    });
    $persistentStore.write(JSON.stringify(blacklist), BLACKLIST_KEY);
    $notification.post(
      "小红书黑名单",
      `✅ 已屏蔽「${userInfo.nickname || userInfo.user_id}」`,
      `黑名单共 ${blacklist.length} 人`
    );
  }

  $done({});  // 放行原请求，XHS 推荐算法正常收到信号
})();
