import share from '../../api/share.js';

export function onRequest({ request, env, clientIp }) {
  const host = request.headers.get('eo-pages-host');
  if (host) {
    // EdgeOne 的 Request URL 使用内部 Host；此头由边缘节点设置。
    const url = new URL(request.url);
    url.host = host;
    url.protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'http' ? 'http:' : 'https:';
    request = new Request(url, request);
  }
  return share.fetch(request, { env, clientIp: clientIp || 'edgeone-unknown' });
}
