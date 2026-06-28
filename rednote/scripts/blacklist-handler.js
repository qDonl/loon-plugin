/**
 * 黑名单操作 Mock 接口
 * 拦截: https://www.xiaohongshu.com/__rednot/blacklist (http-request)
 *
 * 此路径是注入的 JS 专用路径，XHS 本身不存在，Loon 直接返回 mock response。
 * 支持 query 参数:
 *   action=add   user_id=xxx  nickname=xxx
 *   action=check user_id=xxx
 */

const BLACKLIST_KEY = "rednot_blacklist";

(function main() {
  const url = $request.url;
  const rawQuery = url.split("?")[1] || "";
  const params = {};
  rawQuery.split("&").forEach((pair) => {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });

  const action = params.action || "add";
  const userId = params.user_id || "";
  const nickname = params.nickname || "";

  const raw = $persistentStore.read(BLACKLIST_KEY);
  const blacklist = raw ? JSON.parse(raw) : [];

  let responseBody;

  if (action === "add" && userId) {
    const already = blacklist.some((u) => u.user_id === userId);

    if (!already) {
      blacklist.push({
        user_id: userId,
        nickname: nickname,
        added_at: new Date().toISOString(),
      });
      $persistentStore.write(JSON.stringify(blacklist), BLACKLIST_KEY);
      $notification.post(
        "小红书黑名单",
        `✅ 已屏蔽「${nickname || userId}」`,
        `黑名单共 ${blacklist.length} 人`
      );
    }

    responseBody = JSON.stringify({
      success: true,
      already: already,
      count: blacklist.length,
    });
  } else if (action === "check" && userId) {
    const blocked = blacklist.some((u) => u.user_id === userId);
    responseBody = JSON.stringify({ blocked, count: blacklist.length });
  } else {
    responseBody = JSON.stringify({ success: false, error: "invalid params" });
  }

  // 返回 mock response，请求不会发往 XHS 服务器
  $done({
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: responseBody,
    },
  });
})();
