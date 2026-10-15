import { SHARE_ID, SHARE_MAX_BYTES } from './share-config.js';

async function errorMessage(response) {
  const body = await response.json().catch(() => null);
  return body?.error || (response.status === 413 ? '分享内容不能超过 4 MB' : '分享服务暂时不可用，请稍后重试');
}

export function createSharing({ dialog, getText, validate, toast, showShared }) {
  const message = dialog.querySelector('[role="status"]');
  const link = dialog.querySelector('input');
  const copy = dialog.querySelector('[data-share-copy]');
  let pending = false, savedText = null, saved = null;
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(link.value); toast('已复制分享链接'); }
    catch { link.focus(); link.select(); message.textContent = '请按 ⌘ / Ctrl + C 复制链接'; }
  };
  dialog.querySelector('[data-share-close]').onclick = () => dialog.close();
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  return {
    async share() {
      if (pending) return;
      dialog.showModal();
      link.hidden = true; copy.disabled = true;
      message.textContent = '正在校验 JSON…';
      pending = true;
      try {
        const text = getText();
        if (new TextEncoder().encode(text).byteLength > SHARE_MAX_BYTES) throw new Error('分享内容不能超过 4 MB，请先压缩或拆分 JSON');
        await validate();
        if (text !== getText()) throw new Error('内容已更改，请重新分享');
        if (!saved || savedText !== text || saved.expiresAt <= Date.now()) {
          message.textContent = '正在生成分享链接…';
          const response = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text, signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error(await errorMessage(response));
          const data = await response.json();
          if (!SHARE_ID.test(data.id) || !Number.isFinite(data.expiresAt)) throw new Error('分享服务返回异常，请稍后重试');
          saved = data; savedText = text;
        }
        const url = new URL('/', location.href);
        url.hash = `s=${saved.id}`;
        link.value = url.href; link.hidden = false; copy.disabled = false;
        message.textContent = `有效期至 ${new Date(saved.expiresAt).toLocaleString('zh-CN', { hour12: false })}`;
        if (dialog.open) { link.focus(); link.select(); }
      } catch (error) {
        message.textContent = error.name === 'TimeoutError' || error instanceof TypeError ? '网络连接失败，请关闭后重新分享' : error.message;
      } finally { pending = false; }
    },
    async load(id) {
      try {
        if (!SHARE_ID.test(id || '')) throw new Error('分享链接无效或已过期');
        const response = await fetch(`/api/share?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(await errorMessage(response));
        if (!response.headers.get('content-type')?.startsWith('text/plain')) throw new Error('分享服务暂时不可用，请稍后重试');
        const text = await response.text();
        await showShared(text, Number(response.headers.get('X-Share-Expires-At')));
      } catch (error) {
        await showShared(null, null, error.name === 'TimeoutError' || error instanceof TypeError ? '无法加载分享，请检查网络后刷新重试' : error.message);
      }
    },
  };
}
