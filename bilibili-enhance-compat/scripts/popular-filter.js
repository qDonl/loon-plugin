/**
 * B站「热门」信息流过滤：移除黑名单UP的视频卡片
 * 拦截: bilibili.app.show.v1.Popular/Index (http-response, Protobuf 二进制)
 *
 * 背景：
 *  「热门」走的是 gRPC/Protobuf 接口，不像首页 feed/index 是 JSON。
 *  上游 kokoryh 开源的 proto schema 只声明了他自己需要的两个字段
 *  (Base.ad_info / Base.from_type)，UP 的 mid 字段号未知，也没有
 *  公开资料，无法按字段名精确取值。
 *
 * gRPC 帧头（实测确认，见 tools/dump_popular_grpc.py 分析结果）：
 *  content-type: application/grpc 的响应体不是裸 protobuf，外面包了一层
 *  [1 byte compressed-flag][4 byte 大端长度] 帧头，之后才是真正的
 *  protobuf payload。用真实抓包（HAR）验证过：body 开头 5 字节确实是
 *  这个帧头（flag=0 未压缩，声明长度和剩余字节数精确匹配），必须先
 *  剥掉才能解析——如果直接从字节 0 解析会得到 0 个 items（完全对不上）。
 *  这里做自动检测（不是硬编码假设），剥的时候记住剥没剥、compressed-flag
 *  是什么，写回响应时对称地把帧头补回去（用新的长度）。
 *  compressed-flag=1（消息本身被 gzip 压缩）的情况下，纯 JS 环境没有
 *  现成的 inflate 能力，直接放行不做过滤，不冒险破坏响应。
 *
 * 方案（通用 varint 扫描，不依赖完整 schema）：
 *  Protobuf 的 wire format 本身是自描述的（每个字段前有 tag，包含
 *  字段号+wire type），不需要知道字段名/schema 也能把整条消息按
 *  wire type 正确地走一遍。这里对每张卡片的原始字节做递归扫描：
 *  遇到 varint 字段就记录数值，遇到 length-delimited 字段就当成
 *  嵌套消息继续递归（就算它其实是字符串/裸字节，递归扫描顶多扫出
 *  一堆无意义数字，不影响正确性，只是有一点点浪费）。
 *  只要卡片字节里出现过任何一个等于黑名单 UP mid 的 varint，就整
 *  张卡片丢弃——按原始字节切片重组，不重新编码，未声明字段原样
 *  保留，不会破坏卡片其余数据（标题/封面/播放量等）。
 *
 * 已知局限（诚实说明，不是"能完美工作"）：
 *  · 这是数值命中扫描，不是精确字段解析，理论上存在极小概率的
 *    误判——如果某个黑名单 UP 的 mid 恰好是个位数/两位数小数字，
 *    可能和卡片里其他小整数字段（时长秒数、角标类型等）撞车导致
 *    误删无关视频。现代 UP 账号 UID 基本是 6~10 位数，冲突概率
 *    可忽略；如果拉黑的是早期小数字 UID 的老账号，需要留意。
 *  · 只处理 UP 黑名单，不处理分区黑名单——分区 tid 是 1~250 的小
 *    整数，和卡片里其他小整数字段撞车的概率高得多，这套扫描法不
 *    适合拿来做分区过滤。
 *
 * 依赖: $persistentStore 里的 bili_up_blacklist（由 filter.js/dislike.js 维护）
 */

const UP_BLACKLIST_KEY = "bili_up_blacklist";
const MAX_RECURSE_DEPTH = 8;
const MAX_FIELDS_PER_LEVEL = 5000;

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, pos];
}

// 递归收集 buf[start,end) 范围内出现过的所有 varint 数值(BigInt，转成字符串比较)
function collectVarints(buf, start, end, out, depth) {
  if (depth > MAX_RECURSE_DEPTH) return;
  let pos = start;
  let guard = 0;
  while (pos < end) {
    if (++guard > MAX_FIELDS_PER_LEVEL) return;
    const [tag, p1] = readVarint(buf, pos);
    const wireType = Number(tag & 7n);
    pos = p1;
    if (pos >= end) break;

    if (wireType === 0) {
      const [val, p2] = readVarint(buf, pos);
      out.push(val);
      pos = p2;
    } else if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      const l = Number(len);
      if (l < 0 || p2 + l > end) { pos = end; break; } // 长度非法（把裸字节误当嵌套消息），放弃这一层剩余内容
      collectVarints(buf, p2, p2 + l, out, depth + 1);
      pos = p2 + l;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      pos = end; // 未知 wire type，放弃这一层剩余内容
      break;
    }
  }
}

function cardContainsBlockedMid(buf, start, end, blockedMids) {
  const varints = [];
  try { collectVarints(buf, start, end, varints, 0); } catch (_) { return false; }
  return varints.some(v => blockedMids.has(v.toString()));
}

// 判断开头 5 字节是否是合法的 gRPC 帧头：flag ∈ {0,1}，且声明长度正好等于剩余字节数
function looksLikeGrpcFrame(buf) {
  if (buf.length < 5) return false;
  const flag = buf[0];
  if (flag !== 0 && flag !== 1) return false;
  const len = ((buf[1] << 24) | (buf[2] << 16) | (buf[3] << 8) | buf[4]) >>> 0;
  return len === buf.length - 5;
}

function buildGrpcFrame(payload) {
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0; // 未压缩
  out[1] = (payload.length >>> 24) & 0xff;
  out[2] = (payload.length >>> 16) & 0xff;
  out[3] = (payload.length >>> 8) & 0xff;
  out[4] = payload.length & 0xff;
  out.set(payload, 5);
  return out;
}

// ── 临时诊断：确认 Loon 到底怎么把二进制响应体给脚本 ──────────────────
// 排查完 $response.bodyBytes 是否可用后，这段连同下面的 diagnose() 调用
// 一起删掉即可，不是长期功能。
function inspect(val) {
  if (val === undefined || val === null) return "absent";
  const type = Object.prototype.toString.call(val);
  let len = "?";
  try { len = val.byteLength !== undefined ? val.byteLength : (val.length !== undefined ? val.length : "?"); } catch (_) {}
  let preview = "";
  try {
    if (typeof val === "string") {
      preview = Array.prototype.slice.call(val, 0, 6).map(c => c.charCodeAt(0)).join(",");
    } else {
      preview = Array.prototype.slice.call(val, 0, 6).join(",");
    }
  } catch (_) { preview = "(no preview)"; }
  return `${type} len=${len} head=[${preview}]`;
}

function diagnose() {
  try {
    const hasResponse = !!$response;
    const keys = hasResponse ? (() => { try { return Object.keys($response).join(","); } catch (_) { return "(keys unavailable)"; } })() : "";
    const msg = `resp=${hasResponse} keys=${keys}\nbody: ${inspect($response && $response.body)}\nbodyBytes: ${inspect($response && $response.bodyBytes)}`;
    $notification.post("诊断:Popular响应结构", msg.slice(0, 300), "");
  } catch (e) {
    $notification.post("诊断异常", String((e && e.message) || e), "");
  }
}

(function main() {
  try {
    diagnose(); // 临时：每次都发通知，看完就删

    if (!$response || !$response.bodyBytes) return $done({});

    const blacklist = JSON.parse($persistentStore.read(UP_BLACKLIST_KEY) || "[]");
    if (blacklist.length === 0) return $done({});
    const blockedMids = new Set(blacklist.map(u => String(u.up_id)));

    const rawBuf = new Uint8Array($response.bodyBytes);

    let hasFrame = false;
    let buf = rawBuf;
    if (looksLikeGrpcFrame(rawBuf)) {
      if (rawBuf[0] === 1) return $done({}); // 压缩过的消息，没法在这里解压，直接放行
      hasFrame = true;
      buf = rawBuf.subarray(5);
    }

    const chunks = [];
    let pos = 0;
    let removed = 0;

    while (pos < buf.length) {
      const chunkStart = pos;
      const [tag, p1] = readVarint(buf, pos);
      const fieldNo = Number(tag >> 3n);
      const wireType = Number(tag & 7n);
      pos = p1;
      if (pos > buf.length) break; // 数据不完整，丢弃尾部残余字节

      if (wireType === 2) {
        const [len, p2] = readVarint(buf, pos);
        const l = Number(len);
        if (l < 0 || p2 + l > buf.length) break; // 长度非法，停止解析，保留已处理部分
        const itemStart = p2, itemEnd = p2 + l;
        pos = itemEnd;

        // items 字段(fieldNo === 1)才是视频卡片，命中黑名单就整块丢弃；
        // 其他 length-delimited 顶层字段（如分页游标等未知字段）原样保留
        if (fieldNo === 1 && cardContainsBlockedMid(buf, itemStart, itemEnd, blockedMids)) {
          removed++;
          continue;
        }
        chunks.push(buf.subarray(chunkStart, pos));
      } else if (wireType === 0) {
        const [, p2] = readVarint(buf, pos);
        pos = p2;
        chunks.push(buf.subarray(chunkStart, pos));
      } else if (wireType === 1) {
        pos += 8;
        chunks.push(buf.subarray(chunkStart, pos));
      } else if (wireType === 5) {
        pos += 4;
        chunks.push(buf.subarray(chunkStart, pos));
      } else {
        break; // 未知 wire type，停止解析，保留已处理部分
      }
    }

    if (removed === 0) return $done({});

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const newPayload = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) { newPayload.set(c, off); off += c.length; }

    // 剥过帧头的话，写回时要用新的（变短了的）长度对称地把帧头补回去，
    // 不能直接回填裸 payload——不然 App 按帧头声明的长度去读会读错。
    const outBuf = hasFrame ? buildGrpcFrame(newPayload) : newPayload;

    $notification.post("哔哩哔哩", `热门：已过滤 ${removed} 条黑名单UP视频`, "");
    $done({ response: { bodyBytes: outBuf.buffer } });
  } catch (e) {
    // 任何异常都直接放行原始响应，绝不因为过滤逻辑出错而破坏「热门」页面
    $done({});
  }
})();
