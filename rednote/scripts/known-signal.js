/**
 * 兜底方案：从 homefeed 请求的 known_signal 里检测「不感兴趣」
 * 拦截: GET rec.xiaohongshu.com/api/sns/v*/homefeed  (http-request)
 *
 * XHS 把用户行为批量打包在 known_signal.action 里随下一次 homefeed 请求上报。
 * 「不感兴趣」行为用特定 action bitmask 标识（XHS 内部定义）。
 *
 * 工作流程：
 *  1. 解析 known_signal.action，提取所有有 action 字段的 note_id
 *  2. 与上次记录的 action 快照做 diff，找出本次新增的交互
 *  3. 对新增条目发通知（仅 debug 首次），便于确认 action 值后精确过滤
 *  4. 若 action bitmask 命中 NOT_INTERESTING_BITS，写入黑名单
 *
 * ⚙️  NOT_INTERESTING_BITS：
 *    XHS 的 action bitmask 值目前未公开。首次使用时脚本会把检测到的值打印在通知里，
 *    用户确认对应「不感兴趣」的值后，填入下方常量即可精确触发。
 *    填 0 = 关闭此兜底逻辑（仅依赖 not-interested.js 的直接拦截）。
 */

const NOT_INTERESTING_BITS = 0;   // ← 确认后填入，例如 4096

const BLACKLIST_KEY  = "rednot_blacklist";
const NOTE_MAP_KEY   = "rednot_note_user_map";
const PREV_ACT_KEY   = "rednot_prev_actions";
const DEBUG_DONE_KEY = "rednot_signal_debug_done";

(function main() {
  const url = $request.url || "";
  const qs  = url.split("?")[1] || "";

  // 从 URL 参数解析 known_signal
  let knownSignal = {};
  try {
    const raw = new URLSearchParams(qs).get("known_signal") || "{}";
    knownSignal = JSON.parse(decodeURIComponent(raw));
  } catch (_) {
    return $done({});
  }

  const actions = knownSignal?.action || {};
  if (!Object.keys(actions).length) return $done({});

  // 与上次快照 diff，只处理本次新增的 note
  const prevRaw  = $persistentStore.read(PREV_ACT_KEY);
  const prevActs = prevRaw ? JSON.parse(prevRaw) : {};
  const newEntries = Object.entries(actions).filter(([id]) => !prevActs[id]);

  // 更新快照（保留最近 300 条）
  const merged = { ...prevActs, ...actions };
  const keys = Object.keys(merged);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete merged[k]);
  $persistentStore.write(JSON.stringify(merged), PREV_ACT_KEY);

  if (!newEntries.length) return $done({});

  // Debug 通知：首次触发时把 action 值打印出来，帮助确认 NOT_INTERESTING_BITS
  const debugDone = $persistentStore.read(DEBUG_DONE_KEY);
  if (!debugDone) {
    const sample = newEntries.slice(0, 3).map(([id, v]) =>
      `${id.slice(-6)}: action=${v.action ?? "-"}`
    ).join("\n");
    $notification.post("known_signal 调试", "新增 action（前3条）", sample);
    // 触发 5 次后停止 debug 通知
    const cnt = parseInt($persistentStore.read("rednot_dbg_cnt") || "0") + 1;
    $persistentStore.write(String(cnt), "rednot_dbg_cnt");
    if (cnt >= 5) $persistentStore.write("1", DEBUG_DONE_KEY);
  }

  // 若未配置 NOT_INTERESTING_BITS，不执行黑名单逻辑
  if (!NOT_INTERESTING_BITS) return $done({});

  const mapRaw = $persistentStore.read(NOTE_MAP_KEY);
  const noteMap = mapRaw ? JSON.parse(mapRaw) : {};
  const raw = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];
  let changed = false;

  newEntries.forEach(([noteId, v]) => {
    const bits = v.action || 0;
    if (!(bits & NOT_INTERESTING_BITS)) return;

    const userInfo = noteMap[noteId];
    if (!userInfo?.user_id) return;
    if (blacklist.some(u => u.user_id === userInfo.user_id)) return;

    blacklist.push({
      user_id:  userInfo.user_id,
      nickname: userInfo.nickname,
      added_at: new Date().toISOString(),
    });
    changed = true;
    $notification.post("小红书黑名单", `✅ 已屏蔽「${userInfo.nickname || userInfo.user_id}」`, "");
  });

  if (changed) $persistentStore.write(JSON.stringify(blacklist), BLACKLIST_KEY);

  $done({});
})();
