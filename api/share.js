import { createHmac, randomBytes } from 'node:crypto';
import { parseDocument } from '../src/core.js';
import { SHARE_ID, SHARE_MAX_BYTES, SHARE_TTL_SECONDS } from '../src/share-config.js';

// 限额与保存一起执行，避免并发请求绕过免费存储的容量保护。
const saveScript = `
if tonumber(redis.call('GET', KEYS[2]) or '0') >= 20 then return 'rate' end
if tonumber(redis.call('GET', KEYS[3]) or '0') + tonumber(ARGV[3]) > 25165824 then return 'budget' end
if tonumber(redis.call('GET', KEYS[4]) or '0') >= 200 then return 'budget' end
if not redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 'collision' end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 3600)
redis.call('INCRBY', KEYS[3], ARGV[3])
redis.call('EXPIRE', KEYS[3], 86400)
redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[4], 86400)
return 'OK'
`;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
const failure = (message, status, extra = {}) => Response.json({ error: message }, { status, headers: { ...headers, ...extra } });

async function readText(request) {
  if (Number(request.headers.get('content-length')) > SHARE_MAX_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > SHARE_MAX_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!['GET', 'POST'].includes(request.method)) return failure('不支持此请求方式', 405, { Allow: 'GET, POST' });
    const id = url.searchParams.get('id');
    if (request.method === 'GET' && !SHARE_ID.test(id || '')) return failure('分享链接无效或已过期', 404);
    if (request.method === 'POST') {
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return failure('请从本站创建分享', 403);
      if (request.headers.get('content-type')?.split(';')[0] !== 'text/plain') return failure('请以 JSON 原文创建分享', 415);
    }
    const endpoint = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!endpoint || !token) return failure('分享存储尚未连接，请稍后重试', 503);
    const redis = async (command, path = '') => {
      const response = await fetch(`${endpoint.replace(/\/$/, '')}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('存储请求失败');
      const data = await response.json();
      if (data.error || (Array.isArray(data) && data.some(item => item.error))) throw new Error('存储请求失败');
      return data;
    };
    try {
      if (request.method === 'GET') {
        const [value, ttl] = await redis([['GET', `json-share:${id}`], ['TTL', `json-share:${id}`]], '/multi-exec');
        if (typeof value.result !== 'string' || ttl.result <= 0) return failure('分享链接无效或已过期', 404);
        return new Response(value.result, { headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'X-Share-Expires-At': String(Date.now() + ttl.result * 1000) } });
      }
      let text;
      try { text = await readText(request); } catch { return failure('无法读取 JSON，请重新粘贴后分享', 400); }
      if (text === null) return failure('分享内容不能超过 4 MB，请先压缩或拆分 JSON', 413);
      try { parseDocument(text); } catch (error) { return failure(error.message, 400); }
      // Vercel 覆盖此请求头；仅用带密钥摘要限流，不保存原始 IP。
      const ip = request.headers.get('x-vercel-forwarded-for') || 'local';
      const sender = createHmac('sha256', token).update(ip).digest('hex').slice(0, 32);
      const now = Date.now(), day = Math.floor(now / 86400000), hour = Math.floor(now / 3600000);
      const shareId = randomBytes(16).toString('base64url');
      const { result } = await redis(['EVAL', saveScript, 4, `json-share:${shareId}`, `json-share:rate:${sender}:${hour}`, `json-share:bytes:${day}`, `json-share:count:${day}`, text, SHARE_TTL_SECONDS, Buffer.byteLength(text)]);
      if (result === 'rate') return failure('分享太频繁，请一小时后重试', 429, { 'Retry-After': '3600' });
      if (result === 'budget') return failure('今日分享额度已用完，请明天再试；已有链接仍可查看', 429);
      if (result !== 'OK') throw new Error('保存失败');
      return Response.json({ id: shareId, expiresAt: now + SHARE_TTL_SECONDS * 1000 }, { status: 201, headers });
    } catch {
      return failure('分享服务暂时不可用，请稍后重试', 503);
    }
  },
};
