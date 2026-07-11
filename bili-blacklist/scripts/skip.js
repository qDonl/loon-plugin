/**
 * B站空降助手（社区跳过片段标记）
 * 拦截: https://app.bilibili.com/x/v2/view (http-response)
 *
 * 数据来源：BSBSB 社区数据库 https://bsbsb.top/api/skipSegments
 * （与浏览器插件「小电视空降助手 / BilibiliSponsorBlock」同源，众包标注）
 *
 * 原生播放器无法像网页版一样被 JS 直接控制跳转进度，因此本插件用两种方式
 * 呈现查到的片段，哪种生效取决于 App 版本，互为兜底：
 *   1. 尝试把片段写入返回体 data.view_points（章节点字段），若当前 App
 *      版本渲染该字段，进度条上会出现可点击跳转的分段标记。
 *   2. 命中片段时始终推送 Loon 通知，列出各片段时间范围和类型，
 *      即使 1 未生效，用户也能照通知手动拖动进度条跳过。
 *
 * 开关：Loon 插件参数「开启空降助手」→ 对应 [Script] 行 enable={skip_enabled}。
 * 关闭时 Loon 直接不执行本脚本，不产生任何网络请求。
 *
 * 查询结果按 bvid+cid 缓存 12 小时（bili_skip_cache，最多 200 条 LRU），
 * 避免同一视频反复请求社区数据库。
 */

const SKIP_CACHE_KEY = "bili_skip_cache";
const SKIP_LAST_KEY  = "bili_skip_last";
const CACHE_MAX       = 200;
const CACHE_TTL_MS    = 12 * 60 * 60 * 1000; // 12 小时

// 默认查询/标记的片段类型，与浏览器版空降助手默认勾选项保持一致
const CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview"];

const CATEGORY_LABEL = {
  sponsor:          "🚫 广告",
  selfpromo:        "📢 推广",
  interaction:      "👍 互动提醒",
  intro:            "⏭ 片头",
  outro:            "⏹ 片尾",
  preview:          "🔁 回顾/预告",
  music_offtopic:   "🎵 非正片音乐",
  poi_highlight:    "⭐ 精彩时刻",
  filler:           "💬 闲聊",
  exclusive_access: "🔒 抢先/独家",
};

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readCache() {
  return JSON.parse($persistentStore.read(SKIP_CACHE_KEY) || "{}");
}

function writeCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.slice(0, keys.length - CACHE_MAX).forEach(k => delete cache[k]);
  }
  $persistentStore.write(JSON.stringify(cache), SKIP_CACHE_KEY);
}

function finish(data, segments, title) {
  if (Array.isArray(segments) && segments.length > 0 && data && data.data) {
    const points = segments.map(seg => ({
      type:       1,
      from:       seg.start,
      to:         seg.end,
      imgUrl:     "",
      content:    CATEGORY_LABEL[seg.category] || seg.category,
      logo_index: 0,
    }));
    const existing = Array.isArray(data.data.view_points) ? data.data.view_points : [];
    data.data.view_points = points.concat(existing);

    const lines = segments.map(seg =>
      `· ${fmtTime(seg.start)}-${fmtTime(seg.end)} ${CATEGORY_LABEL[seg.category] || seg.category}`
    );
    $notification.post(
      "空降助手",
      `《${title || "当前视频"}》发现 ${segments.length} 处可跳过片段`,
      lines.join("\n")
    );

    $persistentStore.write(JSON.stringify({ title, segments, ts: Date.now() }), SKIP_LAST_KEY);
  }
  $done({ body: JSON.stringify(data) });
}

(function main() {
  const rawBody = $response.body;
  if (!rawBody) return $done({});

  let data;
  try { data = JSON.parse(rawBody); } catch (_) { return $done({}); }

  const video = data && data.data;
  const bvid  = (video && video.bvid) || "";
  const cid   = String((video && video.cid) || "");
  if (!bvid || !cid) return $done({});

  const cacheKey = `${bvid}_${cid}`;
  const cache = readCache();
  const hit = cache[cacheKey];

  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return finish(data, hit.segments, video.title);
  }

  const url = `https://bsbsb.top/api/skipSegments?videoID=${encodeURIComponent(bvid)}`
    + `&cid=${encodeURIComponent(cid)}`
    + `&categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}`;

  $httpClient.get({ url }, (err, resp, body) => {
    const status = resp && resp.status;
    let segments = [];
    let shouldCache = false;

    if (!err && status === 200 && body) {
      shouldCache = true;
      try {
        const list = JSON.parse(body);
        if (Array.isArray(list)) {
          segments = list
            .filter(s => s.actionType === "skip" && Array.isArray(s.segment) && s.segment.length === 2)
            .map(s => ({ start: s.segment[0], end: s.segment[1], category: s.category }));
        }
      } catch (_) {}
    } else if (!err && status === 404) {
      shouldCache = true; // 明确查无片段
    }

    if (shouldCache) {
      cache[cacheKey] = { segments, ts: Date.now() };
      writeCache(cache);
    }

    finish(data, segments, video.title);
  });
})();
