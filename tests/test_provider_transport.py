"""DNS and HTTP wire are fully controlled here; never contact a live provider."""
import asyncio
import json
import socket
import ssl

import httpcore
import httpx
import pytest

from server.provider import PinnedHTTPSTransport, ProviderError, ProviderService, _resolve_public_addresses

PUBLIC_V4 = '93.184.216.34'
PUBLIC_V6 = '2606:4700:4700::1111'
ENDPOINT = 'https://api.provider.com/v1/chat/completions'
FAKE_KEY = 'transport-test-placeholder-not-a-real-key'


@pytest.mark.parametrize('addresses', [
    [], ['127.0.0.1'], ['10.0.0.1'], ['169.254.169.254'], ['168.63.129.16'],
    ['100.64.0.1'], ['fc00::1'], ['fe80::1'], ['::ffff:127.0.0.1'],
    ['64:ff9b::a00:1'], ['2002:7f00:1::'], ['2001::7f00:1'],
    [PUBLIC_V4, '127.0.0.1'], [PUBLIC_V6, '::1'], ['not-an-ip'], [PUBLIC_V4] * 65,
])
def test_all_resolved_addresses_checked_before_any_transport(addresses):
    async def resolver(host, port):
        assert (host, port) == ('api.provider.com', 443)
        return addresses
    def unreachable(_):
        pytest.fail('Unsafe destination reached the network transport')
    async def scenario():
        transport = PinnedHTTPSTransport(ENDPOINT, resolver=resolver, transport=httpx.MockTransport(unreachable))
        async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
            with pytest.raises(ProviderError):
                await client.post(ENDPOINT, headers={'Authorization': 'Bearer ' + FAKE_KEY}, json={})
    asyncio.run(scenario())


@pytest.mark.parametrize('address', [PUBLIC_V4, PUBLIC_V6])
def test_dns_rebinding_does_not_change_pinned_peer_and_tls_keeps_hostname(address):
    resolutions, seen = [], []
    async def resolver(host, port):
        resolutions.append((host, port))
        return [address] if len(resolutions) == 1 else ['127.0.0.1']
    def handler(request):
        assert request.url.host == address
        assert request.headers['Host'] == 'api.provider.com'
        assert request.extensions['sni_hostname'] == 'api.provider.com'
        assert request.url.raw_path == b'/v1/chat/completions'
        assert request.headers['Authorization'] == 'Bearer ' + FAKE_KEY
        seen.append(request)
        return httpx.Response(200, json={})
    async def scenario():
        transport = PinnedHTTPSTransport(ENDPOINT, resolver=resolver, transport=httpx.MockTransport(handler))
        async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
            for _ in range(2):
                await client.post(ENDPOINT, headers={'Authorization': 'Bearer ' + FAKE_KEY}, json={})
    asyncio.run(scenario())
    assert len(resolutions) == 1 and len(seen) == 2


def test_real_httpx_core_uses_numeric_tcp_destination_and_verified_original_tls_host(monkeypatch):
    """Exercise the real HTTPX+HTTPCore translation; mock only socket/TLS I/O.

    This catches a pin wrapper that changes the URL but loses Host/SNI, weakens
    TLS verification, or lets environment proxies replace the pinned destination.
    """
    from httpcore._backends.auto import AutoBackend
    connect_calls, tls_calls, writes, resolutions = [], [], [], []
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:9999')
    monkeypatch.setenv('ALL_PROXY', 'http://127.0.0.1:9999')
    monkeypatch.setenv('SSL_CERT_FILE', '/nonexistent/certificate-file')
    class ControlledStream(httpcore.AsyncNetworkStream):
        async def read(self, max_bytes, timeout=None):
            body = b'{"ok":true}'
            return b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n' + body
        async def write(self, buffer, timeout=None):
            writes.append(buffer)
        async def aclose(self):
            pass
        async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
            assert ssl_context.verify_mode == ssl.CERT_REQUIRED
            assert ssl_context.check_hostname is True
            tls_calls.append(server_hostname)
            return self
        def get_extra_info(self, info):
            return False if info == 'is_readable' else None
    async def connect(backend, host, port, **kwargs):
        connect_calls.append((host, port))
        assert host == PUBLIC_V4  # Never resolve the untrusted hostname again.
        return ControlledStream()
    monkeypatch.setattr(AutoBackend, 'connect_tcp', connect)
    async def resolver(host, port):
        resolutions.append((host, port))
        return [PUBLIC_V4] if len(resolutions) == 1 else ['127.0.0.1']
    async def scenario():
        transport = PinnedHTTPSTransport(ENDPOINT, resolver=resolver)
        async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
            for _ in range(2):
                result = await client.post(ENDPOINT, headers={'Authorization': 'Bearer ' + FAKE_KEY}, json={})
                assert result.json() == {'ok': True}
    asyncio.run(scenario())
    assert connect_calls == [(PUBLIC_V4, 443)]
    assert tls_calls == ['api.provider.com']
    assert resolutions == [('api.provider.com', 443)]
    assert b'Host: api.provider.com\r\n' in b''.join(writes)


def test_nondefault_port_retains_host_and_tls_identity():
    endpoint = 'https://api.provider.com:8443/compatible/v1/chat/completions'
    async def resolver(host, port):
        assert (host, port) == ('api.provider.com', 8443)
        return [PUBLIC_V4]
    def handler(request):
        assert request.url.port == 8443
        assert request.headers['Host'] == 'api.provider.com:8443'
        assert request.extensions['sni_hostname'] == 'api.provider.com'
        return httpx.Response(200)
    async def scenario():
        async with httpx.AsyncClient(transport=PinnedHTTPSTransport(endpoint, resolver=resolver, transport=httpx.MockTransport(handler)), trust_env=False) as client:
            await client.post(endpoint)
    asyncio.run(scenario())


@pytest.mark.parametrize('changed_target', ['https://attacker.com/v1/chat/completions',
                                          'https://api.provider.com/other',
                                          'http://api.provider.com/v1/chat/completions'])
def test_pinned_transport_cannot_be_reused_for_another_destination(changed_target):
    async def resolver(*_):
        pytest.fail('Destination rejected before DNS')
    async def scenario():
        async with httpx.AsyncClient(transport=PinnedHTTPSTransport(ENDPOINT, resolver=resolver), trust_env=False) as client:
            with pytest.raises(ProviderError, match='different destination'):
                await client.post(changed_target)
    asyncio.run(scenario())


def test_generation_change_while_dns_pending_sends_no_key():
    current = True
    async def resolver(*_):
        nonlocal current
        current = False
        return [PUBLIC_V4]
    def unreachable(_):
        pytest.fail('Old session reached transport after DNS completed')
    async def scenario():
        transport = PinnedHTTPSTransport(ENDPOINT, resolver=resolver, transport=httpx.MockTransport(unreachable), generation_current=lambda: current)
        async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
            with pytest.raises(ProviderError, match='session changed'):
                await client.post(ENDPOINT, headers={'Authorization': 'Bearer ' + FAKE_KEY})
    asyncio.run(scenario())


@pytest.mark.parametrize('addresses,blocked', [([PUBLIC_V4, PUBLIC_V6], False),
                                            ([PUBLIC_V4, '127.0.0.1'], True),
                                            ([PUBLIC_V6, 'fd00::1'], True),
                                            (['168.63.129.16'], True), ([], True)])
def test_default_resolver_validates_entire_dns_result(addresses, blocked, monkeypatch):
    async def scenario():
        async def fake_getaddrinfo(host, port, **kwargs):
            assert (host, port) == ('api.provider.com', 443)
            assert kwargs == {'type': socket.SOCK_STREAM, 'proto': socket.IPPROTO_TCP}
            return [(socket.AF_INET6 if ':' in ip else socket.AF_INET, socket.SOCK_STREAM,
                     socket.IPPROTO_TCP, '', (ip, port)) for ip in addresses]
        monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', fake_getaddrinfo)
        if blocked:
            with pytest.raises(ProviderError):
                await _resolve_public_addresses('api.provider.com', 443)
        else:
            assert await _resolve_public_addresses('api.provider.com', 443) == addresses
    asyncio.run(scenario())


def test_dns_failure_does_not_echo_hostname_or_exception(monkeypatch):
    async def scenario():
        async def failing(*_, **__):
            raise OSError('sensitive resolver debug ' + FAKE_KEY)
        monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', failing)
        with pytest.raises(ProviderError, match='Unable to resolve') as error:
            await _resolve_public_addresses('api.provider.com', 443)
        assert FAKE_KEY not in str(error.value)
    asyncio.run(scenario())
