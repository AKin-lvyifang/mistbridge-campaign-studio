const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STUDIO_URL, isStudioUrl, sameDestination, createNativeHandler } = require('./native-protocol.cjs');
const service = { origin: 'http://127.0.0.1:12345', token: 'secret', failure: null, stopping: false };
test('custom scheme validates host instead of opaque Node URL origin', () => {
  assert.equal(isStudioUrl(STUDIO_URL), true);
  for (const url of ['studio://evil/', 'file:///etc/passwd', 'studio://user@app/', 'studio://app:80/', 'https://app/']) {
    assert.equal(isStudioUrl(url), false);
    assert.equal(sameDestination(url, STUDIO_URL), false);
  }
});
test('protocol only proxies to owned loopback and hides token from renderer', async () => {
  let target, options;
  const handler = createNativeHandler(service, async (url, init) => {
    target = url; options = init;
    return new Response('{"ok":true}', { headers: { 'x-studio-instance': service.token } });
  });
  const request = new Request('studio://app/api/export?name=test', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'studio://app' }, body: '{}' });
  const response = await handler(request);
  assert.equal(target, service.origin + '/api/export?name=test');
  assert.equal(options.headers.Origin, service.origin);
  assert.equal(options.headers['X-Studio-Instance'], service.token);
  assert.equal(response.headers.has('x-studio-instance'), false);
  assert.equal(response.status, 200);
});
test('protocol denies cross-origin and foreign-host requests before transport', async () => {
  const handler = createNativeHandler(service, () => { throw new Error('Must not fetch'); });
  assert.equal((await handler(new Request('studio://evil/api/export'))).status, 403);
  assert.equal((await handler(new Request('studio://app/api/export', { headers: { Origin: 'https://evil.example' } }))).status, 403);
  const request = new Request('studio://app/api/health');
  request.initiatorOrigin = 'https://evil.example';
  assert.equal((await handler(request)).status, 403);
});
test('protocol reports an unavailable owned service', async () => {
  const handler = createNativeHandler({ ...service, failure: new Error('Exited') });
  assert.equal((await handler(new Request(STUDIO_URL))).status, 503);
});

test('stable draft origin is independent of native runtime port', async () => {
  const destinations = [];
  for (const port of [19001, 29002]) {
    const owned = { ...service, origin: `http://127.0.0.1:${port}` };
    const handler = createNativeHandler(owned, async url => { destinations.push(url); return new Response('ok'); });
    assert.equal((await handler(new Request(STUDIO_URL))).status, 200);
    assert.equal(STUDIO_URL, 'studio://app/');
  }
  assert.deepEqual(destinations, ['http://127.0.0.1:19001/', 'http://127.0.0.1:29002/']);
});

test('renderer cancellation propagates to the owned service transport', async () => {
  const controller = new AbortController();
  let signal, started;
  const ready = new Promise(resolve => { started = resolve; });
  const handler = createNativeHandler(service, async (_url, init) => {
    signal = init.signal;
    started();
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  });
  const pending = handler(new Request('studio://app/api/lui/chat', {
    method: 'POST', body: '{}', signal: controller.signal,
    headers: {'Content-Type': 'application/json'}
  }));
  await ready;
  controller.abort();
  assert.equal(signal.aborted, true);
  assert.equal((await pending).status, 503);
});
