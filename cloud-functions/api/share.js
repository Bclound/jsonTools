import share from '../../api/share.js';

export function onRequest({ request, env, clientIp }) {
  return share.fetch(request, { env, clientIp: clientIp || 'edgeone-unknown' });
}
