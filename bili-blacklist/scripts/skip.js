/**
 * B站空降助手（社区跳过片段通知）
 * 拦截: https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View (http-response)
 *
 * 现版本 B 站 App（9.x）视频详情走 gRPC + Protobuf（grpc.biliapi.net），
 * 不再是旧版 JSON 接口。响应体结构：
 *   [1 字节压缩标志][4 字节大端长度][protobuf 消息，标志=1 时为 gzip 压缩]
 * 用 Loon 原生 $utils.ungzip 解压后，不做完整 protobuf 解码（字段号未知、
 * 且逆向成本高），而是直接对解压后的原始字节做正则扫描：
 *   · bvid 固定格式 "BV1" + 9 位字母数字，作为字符串字面量出现在消息里
 *   · cid 作为播放地址预加载链接里的 query 参数 "cid=xxxxx" 一并出现
 * 用扫描到的 bvid（+ 可选 cid）向社区数据库 BSBSB（https://bsbsb.top，
 * 与浏览器插件「小电视空降助手」同源数据）查询该视频的广告 / 推广 /
 * 互动提醒 / 片头 / 片尾 / 回顾 等可跳过片段。
 *
 * 本脚本只读嗅探、绝不修改响应体：$done({}) 原样放行，不重新编码 protobuf，
 * 不存在把视频页面搞挂的风险。代价是无法像旧方案那样把片段写回官方接口
 * 做进度条标记（gRPC 新接口没有已知可写的等效字段），命中片段时只能
 * 依赖 Loon 推送通知，用户照通知手动拖动进度条跳过。
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

// 默认查询/提醒的片段类型，与浏览器版空降助手默认勾选项保持一致
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

function bytesToString(bytes) {
  let text = "";
  const CHUNK = 8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return text;
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

function notifyAndRecord(segments, bvid) {
  if (!Array.isArray(segments) || segments.length === 0) return;
  const lines = segments.map(seg =>
    `· ${fmtTime(seg.start)}-${fmtTime(seg.end)} ${CATEGORY_LABEL[seg.category] || seg.category}`
  );
  $notification.post(
    "空降助手",
    `发现 ${segments.length} 处可跳过片段`,
    `${bvid}\n${lines.join("\n")}`
  );
  $persistentStore.write(JSON.stringify({ bvid, segments, ts: Date.now() }), SKIP_LAST_KEY);
}

(function main() {
  const raw = $response.body; // binary-body-mode=true → Uint8Array
  if (!raw || raw.length < 5) return $done({});

  const compressed = raw[0] === 1;
  const len = ((raw[1] << 24) | (raw[2] << 16) | (raw[3] << 8) | raw[4]) >>> 0;
  const frame = raw.subarray(5, 5 + len);

  let bytes;
  try { bytes = compressed ? $utils.ungzip(frame) : frame; } catch (_) { return $done({}); }
  if (!bytes || bytes.length === 0) return $done({});

  const text = bytesToString(bytes);
  const bvidMatch = text.match(/BV1[0-9A-Za-z]{9}/);
  if (!bvidMatch) return $done({});
  const bvid = bvidMatch[0];

  const cidMatch = text.match(/[?&]cid=(\d+)/);
  const cid = cidMatch ? cidMatch[1] : "";

  const cacheKey = cid ? `${bvid}_${cid}` : bvid;
  const cache = readCache();
  const hit = cache[cacheKey];

  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    notifyAndRecord(hit.segments, bvid);
    return $done({});
  }

  let url = `https://bsbsb.top/api/skipSegments?videoID=${encodeURIComponent(bvid)}`;
  if (cid) url += `&cid=${encodeURIComponent(cid)}`;
  url += `&categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}`;

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

    notifyAndRecord(segments, bvid);
    $done({});
  });
})();
