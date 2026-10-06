'use strict';
const STUDIO_URL = 'studio://app/';
function isStudioUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'studio:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
  } catch { return false; }
}
function sameDestination(input, target) {
  try {
    const url = new URL(input), expected = new URL(target);
    return url.protocol === expected.protocol && url.host === expected.host && !url.username && !url.password;
  } catch { return false; }
}
function createNativeHandler(service, transport = fetch) {
  return async request => {
    if (!isStudioUrl(request.url) ||
        (request.initiatorOrigin && request.initiatorOrigin !== 'studio://app') ||
        (request.headers.get('origin') && request.headers.get('origin') !== 'studio://app'))
      return new Response('Untrusted desktop origin.', { status: 403 });
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Unsupported method.', { status: 405 });
    if (!service.origin || service.failure || service.stopping) return new Response('Native service unavailable.', { status: 503 });
    const url = new URL(request.url);
    const headers = { 'X-Studio-Instance': service.token, Origin: service.origin };
    const media = request.headers.get('content-type');
    if (media) headers['Content-Type'] = media;
    try {
      const response = await transport(service.origin + url.pathname + url.search, {
        method: request.method, headers, body: request.body, duplex: 'half', redirect: 'error', signal: request.signal
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('x-studio-instance'); // Ownership proof stays in main.
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
    } catch { return new Response('Native service unavailable.', { status: 503 }); }
  };
}
module.exports = { STUDIO_URL, isStudioUrl, sameDestination, createNativeHandler };
