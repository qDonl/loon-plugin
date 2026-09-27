/**
 * 丰巢小程序无开屏广告入口
 * 拦截: http://fcbox.open* (request script)
 *
 * 用法：Loon 运行中，Safari 访问 http://fcbox.open（或点插件详情「主页」链接），
 * 页面自动拉起微信打开丰巢小程序。可在 Safari 分享菜单「添加到主屏幕」作为桌面入口。
 *
 * 原理：丰巢 H5 中转页 edms.fcbox.com/.../cleanexpert/jump-mp.html 调用
 * webchatapp.fcbox.com/base/wechatFunc/getMiniScheme 生成加密 URL Scheme
 * （weixin://dl/business/?t=xxx）。实测通过该 Scheme 冷启动进入丰巢不展示封面广告。
 * 签名算法与中转页一致：md5("functionCode=..&customParam=..&time=..&FCBOXWECHATCORE")
 * 按 time 的前 10 位数字作为下标取字符。
 * Scheme 有效期由接口返回（目前 86400 秒），有效期内缓存复用，与中转页行为一致。
 *
 * 落地页：functionCode=fcRepairHomePage（保洁清洗主页）。接口只开放了少数几个
 * functionCode，没有直达首页的，进入后点底部「首页」即可。
 */

const FUNCTION_CODE = "fcRepairHomePage";
const CUSTOM_PARAM = JSON.stringify({ channelId: "xhziyuanwei01", isShowSplashAd: "false" });
const CACHE_KEY = "fcbox_launch_scheme";
const CACHE_MARGIN_MS = 10 * 60 * 1000; // 剩余不足 10 分钟就重新获取
const API = "https://webchatapp.fcbox.com/base/wechatFunc/getMiniScheme";

(function main() {
  const cached = readCache();
  if (cached) return htmlDone(page(cached, ""));

  const time = String(Date.now());
  const md5Str = md5("functionCode=" + FUNCTION_CODE + "&customParam=" + CUSTOM_PARAM + "&time=" + time + "&FCBOXWECHATCORE");
  let sign = "";
  for (let i = 0; i < 10; i++) sign += md5Str[Number(time[i])];

  const body = "functionCode=" + encodeURIComponent(FUNCTION_CODE) +
    "&customParam=" + encodeURIComponent(CUSTOM_PARAM) +
    "&time=" + time;

  $httpClient.post({
    url: API,
    timeout: 8000,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "AuthSign": sign },
    body: body
  }, function (error, response, data) {
    if (error) return htmlDone(page("", "请求丰巢接口失败：" + error));
    let json;
    try { json = JSON.parse(data); } catch (e) { return htmlDone(page("", "接口返回无法解析：" + String(data).slice(0, 200))); }
    const url = json && json.data && json.data.url;
    if (json.code !== 300100000 || !url) return htmlDone(page("", "接口返回异常：" + (json.msg || String(data).slice(0, 200))));
    const expireMs = Date.now() + (Number(json.data.expire) || 0) * 1000;
    $persistentStore.write(JSON.stringify({ url: url, expire: expireMs }), CACHE_KEY);
    htmlDone(page(url, ""));
  });
})();

function readCache() {
  try {
    const c = JSON.parse($persistentStore.read(CACHE_KEY) || "null");
    if (c && c.url && c.expire - Date.now() > CACHE_MARGIN_MS) return c.url;
  } catch (e) {}
  return "";
}

function htmlDone(html) {
  $done({ response: { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, body: html } });
}

function page(scheme, err) {
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const main = scheme
    ? '<p>正在打开微信…</p><a class="btn" href="' + esc(scheme) + '">打开丰巢小程序</a>' +
      '<script>location.href=' + JSON.stringify(scheme) + '</script>'
    : '<p class="err">' + esc(err) + '</p><a class="btn" href="/">重试</a>';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="apple-mobile-web-app-title" content="丰巢">' +
    '<title>丰巢（无广告）</title><style>' +
    'body{font:16px -apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;margin:0 16px;background:#f5f5f5;color:#222}' +
    '.btn{display:inline-block;margin-top:16px;padding:12px 28px;border-radius:24px;background:#07c160;color:#fff;text-decoration:none}' +
    '.err{color:#d33;word-break:break-all}</style></head><body>' + main + '</body></html>';
}

/* MD5（RFC 1321），返回 32 位小写十六进制；输入按 UTF-8 编码 */
function md5(str) {
  const bytes = unescape(encodeURIComponent(str));
  const n = bytes.length;
  const words = [];
  for (let i = 0; i < n; i++) words[i >> 2] |= (bytes.charCodeAt(i) & 0xff) << ((i % 4) * 8);
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  const total = (((n + 8) >> 6) + 1) * 16;
  for (let i = words.length; i < total; i++) words[i] = words[i] || 0;
  words[total - 2] = n * 8;

  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let off = 0; off < total; off += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const x = (a + f + K[i] + words[off + g]) | 0;
      a = d; d = c; c = b;
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  let hex = "";
  [a0, b0, c0, d0].forEach(v => { for (let i = 0; i < 4; i++) hex += ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, "0"); });
  return hex;
}
