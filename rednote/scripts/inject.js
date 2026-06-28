/**
 * 小红书笔记详情页 JS 注入
 * 拦截: https://www.xiaohongshu.com/explore/* (http-response, requires-body=true)
 *
 * 在页面底部注入一个悬浮「加入黑名单」按钮。
 * 点击后向同域 /__rednot/blacklist 发请求，由 blacklist-handler.js 处理并写入持久化存储。
 */

(function main() {
  const contentType = ($response.headers || {})["Content-Type"] ||
                      ($response.headers || {})["content-type"] || "";
  if (!contentType.includes("text/html")) return $done({});

  let body = $response.body;
  if (!body) return $done({});

  // 只注入一次（防止重定向后二次注入）
  if (body.includes("__rednot_btn")) return $done({});

  const injectedScript = `
<style>
#__rednot_btn {
  position: fixed;
  right: 16px;
  bottom: 88px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 9px 16px;
  background: #ff2d55;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  font-family: -apple-system, sans-serif;
  border: none;
  border-radius: 24px;
  box-shadow: 0 4px 12px rgba(255,45,85,.45);
  cursor: pointer;
  transition: opacity .2s, transform .15s;
  -webkit-tap-highlight-color: transparent;
}
#__rednot_btn.success { background: #34c759; box-shadow: 0 4px 12px rgba(52,199,89,.45); }
#__rednot_btn.error   { background: #8e8e93; }
#__rednot_btn:active  { transform: scale(.95); }
</style>
<script>
(function () {
  'use strict';

  /* ---------- 获取作者 user_id ---------- */
  function getAuthorInfo () {
    // 方法 1: 从 DOM 中找 /user/profile/<userId> 链接（最稳定）
    var anchor = document.querySelector('a[href*="/user/profile/"]');
    if (anchor) {
      var m = anchor.href.match(/\\/user\\/profile\\/([0-9a-f]{20,})/);
      if (m) {
        var nick = (document.querySelector('.author-name, .username, [class*="author"] .name') || {}).textContent || '';
        return { user_id: m[1], nickname: nick.trim() };
      }
    }

    // 方法 2: 从 window.__INITIAL_STATE__ 读（Nuxt SSR 注入）
    var state = window.__INITIAL_STATE__;
    if (state) {
      // 兼容多种路径
      var noteId = location.pathname.split('/').filter(Boolean).pop();
      var candidates = [
        state.noteDetail,
        state.noteDetailMap && state.noteDetailMap[noteId],
        state.note && state.note.noteDetail,
      ];
      for (var i = 0; i < candidates.length; i++) {
        var nd = candidates[i];
        if (!nd) continue;
        var u = nd.user || nd.authorUser || {};
        var uid = u.userId || u.user_id;
        if (uid) return { user_id: uid, nickname: u.nickname || u.nickName || '' };
      }
    }

    return null;
  }

  /* ---------- 渲染按钮 ---------- */
  function renderBtn (author) {
    if (document.getElementById('__rednot_btn')) return;

    var btn = document.createElement('button');
    btn.id = '__rednot_btn';
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> 加入黑名单';

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.style.opacity = '0.7';
      fetch(
        '/__rednot/blacklist?action=add' +
        '&user_id=' + encodeURIComponent(author.user_id) +
        '&nickname=' + encodeURIComponent(author.nickname)
      )
        .then(function (r) { return r.json(); })
        .then(function (data) {
          btn.classList.add(data.already ? 'error' : 'success');
          btn.innerHTML = data.already ? '已在黑名单中' : '✓ 已加入黑名单';
          setTimeout(function () { btn.style.display = 'none'; }, 2200);
        })
        .catch(function () {
          btn.classList.add('error');
          btn.textContent = '添加失败，请重试';
          btn.disabled = false;
          btn.style.opacity = '1';
        });
    });

    document.body.appendChild(btn);
  }

  /* ---------- 入口：等待内容渲染 ---------- */
  function tryInit (retry) {
    var author = getAuthorInfo();
    if (author && author.user_id) {
      renderBtn(author);
      return;
    }
    if (retry > 0) setTimeout(function () { tryInit(retry - 1); }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { tryInit(10); });
  } else {
    tryInit(10);
  }
})();
</script>`;

  // 注入到 </body> 前（SSR 页面必然有 </body>）
  if (body.includes("</body>")) {
    body = body.replace("</body>", injectedScript + "\n</body>");
  } else {
    body += injectedScript;
  }

  $done({ body });
})();
