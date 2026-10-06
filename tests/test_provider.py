"""All provider calls are intercepted by httpx.MockTransport; no live keys or network."""
import asyncio
import copy
import json

import httpx
import pytest

from server.provider import ProviderError, ProviderService, MAX_ROUNDS, TOOLS

FAKE_KEY = 'unit-test-placeholder-not-a-real-credential'


def settings(**overrides):
    return {'providerName': 'DeepSeek', 'baseUrl': 'https://api.deepseek.com',
            'model': 'deepseek-flash', 'key': FAKE_KEY, 'preset': 'deepseek', **overrides}


def payload(session_revision=1):
    return {'sessionRevision': session_revision, 'messages': [{'role': 'user', 'content': 'Raise a 2 by 2 hill at 10,10.'}], 'context': {
        'projectId': 'test-project', 'revision': 'rev1', 'name': 'Test project', 'imported': False,
        'map': {'width': 36, 'height': 36, 'terrainCounts': {'0': 1296}, 'elevationRange': [0, 0], 'samples': [[0, 0, 0, 0]]},
        'objects': {'total': 0, 'items': []}, 'story': {'total': 0, 'items': []}, 'selectedObjectId': None,
        'catalog': {'malicious': 'untrusted catalog data'}}}


def reply(calls=None, content='The changes are ready for local review.', finish=None):
    return {'choices': [{'finish_reason': finish or ('tool_calls' if calls else 'stop'),
                        'message': {'role': 'assistant', 'content': content, **({'tool_calls': calls} if calls else {})}}],
            'usage': {'prompt_tokens': 22, 'completion_tokens': 10}}


def call(name='set_elevation', args=None, call_id='tool-1'):
    if args is None: args = {'region': {'x': 10, 'y': 10, 'width': 2, 'height': 2}, 'elevation': 5}
    return {'id': call_id, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


def run(responses, data=None):
    seen = []
    def handler(request):
        assert str(request.url) == 'https://api.deepseek.com/chat/completions'
        assert request.headers['authorization'] == 'Bearer ' + FAKE_KEY
        seen.append(json.loads(request.content))
        result = responses.pop(0)
        return result if isinstance(result, httpx.Response) else httpx.Response(200, json=result)
    service = ProviderService(transport=httpx.MockTransport(handler))
    service.configure(settings())
    data = copy.deepcopy(data) if data is not None else payload()
    if type(data.get('sessionRevision')) is int and data['sessionRevision'] == 1:
        data['sessionRevision'] = service.status()['sessionRevision']
    result = asyncio.run(service.chat(data))
    return result, seen, service


def test_real_documented_tool_loop_stages_commands_and_returns_results():
    result, seen, service = run([reply([call()]), reply()])
    assert len(seen) == 2
    assert seen[0]['model'] == 'deepseek-flash'
    assert seen[0]['thinking'] == {'type': 'disabled'}
    assert seen[0]['stream'] is False
    assert seen[1]['messages'][-2]['role'] == 'assistant'
    assert seen[1]['messages'][-2]['tool_calls'][0]['id'] == 'tool-1'
    assert seen[1]['messages'][-1]['tool_call_id'] == 'tool-1'
    assert 'NOT APPLIED' in seen[1]['messages'][-1]['content']
    assert result['commands'][0]['type'] == 'set_elevation'
    assert result['commands'][0]['elevation'] == 5
    assert result['usage'] == {'promptTokens': 44, 'completionTokens': 20}
    assert result['rounds'] == 2
    assert 'untrusted catalog data' not in json.dumps(seen)
    assert FAKE_KEY not in json.dumps(result)
    assert FAKE_KEY not in repr(service.__dict__)


def test_key_is_session_only_status_never_echoes_and_clear_disconnects():
    service = ProviderService(transport=httpx.MockTransport(lambda _: httpx.Response(500)))
    assert not service.status()['configured']
    assert service.configure(settings())['configured']
    assert FAKE_KEY not in json.dumps(service.status())
    assert service.clear()['configured'] is False
    with pytest.raises(ProviderError, match='not configured'):
        asyncio.run(service.chat(payload(service.status()['sessionRevision'])))


@pytest.mark.parametrize('value', ['', 'short', 'contains whitespace', '\n' + FAKE_KEY, 'x' * 513, None])
def test_invalid_secret_input_has_only_static_errors(value):
    service = ProviderService()
    with pytest.raises(ProviderError, match='format is invalid'):
        service.configure(settings(key=value))


def test_rejected_unsupported_call_is_sent_back_and_model_can_repair():
    result, seen, _ = run([reply([call('execute_script', {'code': 'unsafe()'})]), reply([call(call_id='tool-2')]), reply()])
    assert result['toolResults'][0]['ok'] is False
    assert result['toolResults'][0]['name'] == 'unsupported_tool'
    assert len(result['commands']) == 1
    assert 'Rejected' in seen[1]['messages'][-1]['content']


@pytest.mark.parametrize('args', [
    {'region': {'x': 10, 'y': 10, 'width': 2, 'height': 2}, 'elevation': 17},
    {'region': {'x': 10, 'y': 10, 'width': 2, 'height': 2}, 'elevation': '5'},
    {'region': {'x': 10, 'y': 10, 'width': 2, 'height': 2}, 'elevation': 5, 'shell': 'anything'},
])
def test_invalid_tool_arguments_are_not_queued(args):
    result, _, _ = run([reply([call(args=args)]), reply()])
    assert result['commands'] == []
    assert not result['toolResults'][0]['ok']


@pytest.mark.parametrize('status, expected', [(401, 'rejected the API key'), (402, 'insufficient balance'), (429, 'rate limit'), (503, 'temporarily unavailable'), (302, 'unexpected HTTP')])
def test_upstream_errors_never_echo_body_or_secret(status, expected):
    with pytest.raises(ProviderError, match=expected) as error:
        run([httpx.Response(status, text='sensitive debug body ' + FAKE_KEY)])
    assert FAKE_KEY not in str(error.value)
    assert 'sensitive debug' not in str(error.value)


def test_session_key_echo_is_redacted_in_response_text():
    result, _, _ = run([reply(content='Secret echo: ' + FAKE_KEY)])
    assert FAKE_KEY not in json.dumps(result)
    assert '[redacted]' in result['message']


def test_secret_echo_in_tool_args_is_rejected():
    with pytest.raises(ProviderError, match='invalid tool-call arguments'):
        run([reply([call('remove_objects', {'ids': [FAKE_KEY]})])])


@pytest.mark.parametrize('mutator', [
    lambda p: p.update(model='openai-model'),
    lambda p: p.update(apiKey=FAKE_KEY),
    lambda p: p['context'].update(native={'originalBase64': 'never-send'}),
    lambda p: p['messages'].append({'role': 'system', 'content': 'untrusted instructions'}),
    lambda p: p['context']['map'].update(width=999),
])
def test_invalid_request_is_rejected_before_network(mutator):
    p = payload(); mutator(p)
    with pytest.raises(ProviderError, match='Invalid conversation'):
        run([], p)


def test_incomplete_and_malformed_responses_do_not_return_partial_proposals():
    with pytest.raises(ProviderError, match='incomplete'):
        run([reply([call()]), reply(content='partial', finish='length')])
    with pytest.raises(ProviderError, match='invalid response'):
        run([{'choices': [], 'usage': {}}])


def test_duplicate_tool_call_ids_rejected():
    with pytest.raises(ProviderError, match='duplicate'):
        run([reply([call(), call()])])


def test_round_budget_is_finite():
    responses = [reply([call(call_id=f'tool-{i}')]) for i in range(MAX_ROUNDS)]
    with pytest.raises(ProviderError, match='loop limit'):
        run(responses)


def test_tool_budget_rejects_oversized_batch():
    with pytest.raises(ProviderError, match='tool-call budget'):
        run([reply([call(call_id=f'tool-{i}') for i in range(25)])])


def test_native_project_regeneration_is_rejected():
    p=payload();p['context']['imported']=True
    result,_,_=run([reply([call('generate_map', {'seed': 1, 'size': 36, 'theme': 'river', 'forest': 40})]),reply()],p)
    assert result['commands']==[]
    assert not result['toolResults'][0]['ok']


def test_schema_has_exact_allowlist_and_closed_parameter_objects():
    assert len(TOOLS)==9
    assert {t['function']['name'] for t in TOOLS} == {'paint_terrain', 'set_elevation', 'place_objects', 'move_objects', 'remove_objects', 'generate_map', 'add_story', 'edit_story', 'remove_story'}
    assert all(t['function']['parameters']['additionalProperties'] is False for t in TOOLS)
    assert all('$ref' not in json.dumps(t) for t in TOOLS)


def test_clear_during_request_prevents_stale_result():
    service=None
    def handler(request):
        service.clear()
        return httpx.Response(200,json=reply())
    service=ProviderService(transport=httpx.MockTransport(handler));service.configure(settings())
    with pytest.raises(ProviderError,match='session changed'):
        asyncio.run(service.chat(payload(service.status()['sessionRevision'])))


def test_cancel_propagates_and_releases_service_lock():
    async def scenario():
        started=asyncio.Event()
        async def handler(request):
            started.set();await asyncio.sleep(60)
            return httpx.Response(200,json=reply())
        service=ProviderService(transport=httpx.MockTransport(handler));service.configure(settings())
        task=asyncio.create_task(service.chat(payload(service.status()['sessionRevision'])));await started.wait();task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert not service._busy.locked()
    asyncio.run(scenario())


def test_accidental_chat_secret_is_blocked_before_transport():
    p=payload();p['messages'][0]['content']='sk-'+'X'*32
    with pytest.raises(ProviderError,match='not sent') as error:
        run([],p)
    assert p['messages'][0]['content'] not in str(error.value)


def test_unicode_escaped_secret_in_decoded_tool_argument_is_blocked():
    escaped = ''.join('\\u%04x' % ord(c) for c in FAKE_KEY)
    tool = call('place_objects', {'objects': [{'id': 'lui-new', 'nativeId': 448, 'player': 1, 'x': 10, 'y': 10, 'rotation': 0, 'label': 'placeholder'}]})
    tool['function']['arguments'] = tool['function']['arguments'].replace('placeholder', escaped)
    assert FAKE_KEY not in tool['function']['arguments']
    with pytest.raises(ProviderError, match='credential material') as error:
        run([reply([tool]), reply()])
    assert FAKE_KEY not in str(error.value)


def test_unicode_escaped_secret_in_tool_property_name_is_blocked():
    escaped = ''.join('\\u%04x' % ord(c) for c in FAKE_KEY)
    tool = call()
    tool['function']['arguments'] = '{"' + escaped + '": "anything"}'
    with pytest.raises(ProviderError, match='credential material'):
        run([reply([tool]), reply()])


def test_session_secret_in_context_never_leaves_service():
    p=payload();p['context']['name']='prefix '+FAKE_KEY+' suffix'
    with pytest.raises(ProviderError,match='not sent'):
        run([],p)


@pytest.mark.parametrize('configuration, expected_endpoint', [
    (settings(), 'https://api.deepseek.com/chat/completions'),
    (settings(providerName='Second Provider', baseUrl='https://api.second-provider.com/v1/',
              model='vendor/custom-tool-model-2026', preset='custom'),
     'https://api.second-provider.com/v1/chat/completions'),
    (settings(providerName='OpenAI', baseUrl='https://api.openai.com/v1',
              model='gpt-4.1-mini', preset='openai'),
     'https://api.openai.com/v1/chat/completions'),
])
def test_distinct_provider_configs_use_same_typed_tool_loop(configuration, expected_endpoint):
    seen = []
    replies = [reply([call()]), reply()]
    def handler(request):
        assert str(request.url) == expected_endpoint
        assert request.headers['authorization'] == 'Bearer ' + FAKE_KEY
        body = json.loads(request.content)
        assert body['model'] == configuration['model']
        assert ('thinking' in body) is (configuration['preset'] == 'deepseek')
        assert not {'api_key', 'key', 'baseUrl', 'providerName', 'preset', 'sessionRevision'} & set(body)
        seen.append(body)
        return httpx.Response(200, json=replies.pop(0))
    service = ProviderService(transport=httpx.MockTransport(handler))
    state = service.configure(configuration)
    assert state['endpoint'] == expected_endpoint
    assert state['baseUrl'] == configuration['baseUrl'].rstrip('/')
    result = asyncio.run(service.chat(payload(service.status()['sessionRevision'])))
    assert len(seen) == 2 and result['commands'][0]['type'] == 'set_elevation'
    assert result['model'] == configuration['model']
    assert result['sessionRevision'] == state['sessionRevision']


def test_custom_deepseek_host_does_not_receive_vendor_specific_parameters():
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=reply())
    service = ProviderService(transport=httpx.MockTransport(handler))
    service.configure(settings(preset='custom', model='some-new-model'))
    asyncio.run(service.chat(payload(service.status()['sessionRevision'])))
    assert 'thinking' not in seen[0]


@pytest.mark.parametrize('field,value,error', [
    ('key', None, 'API key format'), ('key', 'short', 'API key format'),
    ('providerName', '', 'Provider name format'), ('providerName', 'x\nY', 'Provider name format'),
    ('model', '', 'Model name format'), ('model', 'model name', 'Model name format'),
    ('model', 'x' * 201, 'Model name format'), ('model', True, 'Model name format'),
    ('baseUrl', 'http://api.provider.com/v1', 'HTTPS'), ('preset', 'unknown', 'Invalid provider settings'),
])
def test_static_field_validation_errors_preserve_previous_session(field, value, error):
    service = ProviderService()
    before = service.configure(settings())
    with pytest.raises(ProviderError, match=error):
        service.configure(settings(**{field: value}))
    assert service.status() == before


@pytest.mark.parametrize('url', [
    'http://api.provider.com/v1', 'file:///etc/passwd', 'https://localhost',
    'https://localhost.localdomain', 'https://metadata.google.internal', 'https://server.lan/v1',
    'https://foo.local', 'https://printer.home.arpa', 'https://127.0.0.1',
    'https://0.0.0.0', 'https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.0.1',
    'https://169.254.169.254', 'https://168.63.129.16', 'https://100.100.100.200',
    'https://224.0.0.1', 'https://255.255.255.255', 'https://[::1]', 'https://[::]',
    'https://[fd00::1]', 'https://[fe80::1]', 'https://[::ffff:127.0.0.1]',
    'https://[64:ff9b::7f00:1]', 'https://[2002:7f00:1::]', 'https://[2001::7f00:1]',
    'https://[fe80::1%25eth0]', 'https://2130706433', 'https://0177.0.0.1', 'https://127.1',
    'https://0x7f000001', 'https://user:password@api.provider.com/v1',
    'https://api.provider.com?key=anything', 'https://api.provider.com?',
    'https://api.provider.com#fragment', 'https://api.provider.com#',
    'https://api.provider.com/v1/chat/completions', 'https://api.provider.com/v1/../v2',
    'https://api.provider.com/%2e%2e', 'https://api.provider.com\\@localhost',
    'https://api.provider.com:0', 'https://api.provider.com:65536', 'https://api.provider.com.',
    'https://api.provider.com/ api', 'https://api.provider.com\n',
])
def test_unsafe_base_urls_are_rejected_without_dns_or_network(url):
    service = ProviderService()
    with pytest.raises(ProviderError):
        service.configure(settings(baseUrl=url, preset='custom'))
    assert not service.status()['configured']


@pytest.mark.parametrize('url,expected', [
    ('https://API.Provider.com/v1/', 'https://api.provider.com/v1'),
    ('https://api.provider.com:443/', 'https://api.provider.com'),
    ('https://api.provider.com:8443/openai/v1/', 'https://api.provider.com:8443/openai/v1'),
    ('https://api.provider.com/compatible-mode/v1', 'https://api.provider.com/compatible-mode/v1'),
    ('https://93.184.216.34/v1', 'https://93.184.216.34/v1'),
    ('https://[2606:4700:4700::1111]/v1', 'https://[2606:4700:4700::1111]/v1'),
])
def test_normalized_base_keeps_explicit_version_path(url, expected):
    service = ProviderService()
    state = service.configure(settings(baseUrl=url, preset='custom'))
    assert state['baseUrl'] == expected
    assert state['endpoint'] == expected + '/chat/completions'


@pytest.mark.parametrize('preset,url', [('deepseek', 'https://attacker.com'),
                                       ('openai', 'https://api.deepseek.com'),
                                       ('openai', 'https://api.openai.com/other')])
def test_preset_cannot_mislabel_a_custom_destination(preset, url):
    with pytest.raises(ProviderError, match='Official preset destination'):
        ProviderService().configure(settings(preset=preset, baseUrl=url))


def test_credential_in_public_settings_is_blocked_and_never_echoed():
    for field in ('providerName', 'baseUrl', 'model'):
        value = 'https://provider.com/' + FAKE_KEY if field == 'baseUrl' else FAKE_KEY
        service = ProviderService()
        with pytest.raises(ProviderError) as error:
            service.configure(settings(**{field: value}))
        assert FAKE_KEY not in str(error.value)
        assert FAKE_KEY not in json.dumps(service.status())


def test_destination_key_and_model_are_atomically_replaced_not_mixed():
    key_b = 'another-placeholder-not-a-real-key'
    seen = []
    service = None
    def handler(request):
        seen.append((str(request.url), request.headers['authorization'], json.loads(request.content)['model']))
        if len(seen) == 1:
            service.configure(settings(providerName='Second Provider', baseUrl='https://api.second-provider.com/v1',
                                       model='second-tool-model', key=key_b, preset='custom'))
        return httpx.Response(200, json=reply())
    service = ProviderService(transport=httpx.MockTransport(handler))
    initial = service.configure(settings())
    original = payload(initial['sessionRevision'])
    with pytest.raises(ProviderError, match='session changed'):
        asyncio.run(service.chat(original))
    with pytest.raises(ProviderError, match='session changed'):
        asyncio.run(service.chat(original))  # Old history/revision cannot be sent to provider B.
    assert len(seen) == 1
    newer = payload(service.status()['sessionRevision'])
    result = asyncio.run(service.chat(newer))
    assert seen == [('https://api.deepseek.com/chat/completions', 'Bearer ' + FAKE_KEY, 'deepseek-flash'),
                    ('https://api.second-provider.com/v1/chat/completions', 'Bearer ' + key_b, 'second-tool-model')]
    assert result['sessionRevision'] == initial['sessionRevision'] + 1
    assert key_b not in repr(service.__dict__)
    assert service.clear()['sessionRevision'] == initial['sessionRevision'] + 2


@pytest.mark.parametrize('revision', [None, True, -1, '1', 9007199254740992])
def test_missing_or_invalid_session_revision_never_reaches_transport(revision):
    p = payload()
    if revision is None:
        p.pop('sessionRevision')
    else:
        p['sessionRevision'] = revision
    with pytest.raises(ProviderError, match='Invalid conversation'):
        run([], p)


@pytest.mark.parametrize('status', [400, 422])
def test_unsupported_tool_protocol_error_is_actionable_and_body_is_private(status):
    with pytest.raises(ProviderError, match='supports tools/function calling') as error:
        run([httpx.Response(status, json={'error': {'message': 'tools unsupported ' + FAKE_KEY}})])
    assert FAKE_KEY not in str(error.value)


def test_redirect_response_never_sends_key_to_location():
    seen = []
    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(307, headers={'Location': 'https://attacker.com/collect'})
    service = ProviderService(transport=httpx.MockTransport(handler))
    service.configure(settings())
    with pytest.raises(ProviderError, match='unexpected HTTP status'):
        asyncio.run(service.chat(payload(service.status()['sessionRevision'])))
    assert seen == ['https://api.deepseek.com/chat/completions']


@pytest.mark.parametrize('field', ['providerName', 'baseUrl', 'model'])
def test_likely_credential_patterns_cannot_appear_in_public_status_fields(field):
    other_secret = 'sk-' + 'X' * 32
    value = 'https://provider.com/' + other_secret if field == 'baseUrl' else other_secret
    service = ProviderService()
    with pytest.raises(ProviderError, match='Credential material') as error:
        service.configure(settings(**{field: value}, preset='custom'))
    assert other_secret not in str(error.value)
    assert other_secret not in json.dumps(service.status())


@pytest.mark.parametrize('upstream', [None, [], {'choices': [None]}, {'choices': [reply()['choices'][0]], 'usage': []},
                                    {'choices': [reply()['choices'][0]], 'usage': ['bad']}])
def test_malformed_response_shapes_are_safe_errors(upstream):
    # Empty lists are the provider's optional zero usage, matching previous behavior.
    if isinstance(upstream, dict) and upstream.get('usage') == []:
        result, _, _ = run([upstream]); assert result['usage'] == {'promptTokens': 0, 'completionTokens': 0}
    else:
        with pytest.raises(ProviderError, match='invalid response'):
            run([upstream])


def test_service_restart_cannot_reuse_old_session_revision_or_send_old_history():
    def unreachable(_):
        pytest.fail('Previous process history was sent to the replacement provider')
    service_a = ProviderService(transport=httpx.MockTransport(unreachable))
    old = service_a.configure(settings())
    old_request = payload(old['sessionRevision'])
    service_b = ProviderService(transport=httpx.MockTransport(unreachable))
    newer = service_b.configure(settings(providerName='Second Provider', baseUrl='https://api.second-provider.com/v1',
                                        model='second-model', key='restart-placeholder-not-a-real-key', preset='custom'))
    assert old['sessionRevision'] != newer['sessionRevision']
    assert 0 <= newer['sessionRevision'] <= 9007199254740991
    with pytest.raises(ProviderError, match='session changed'):
        asyncio.run(service_b.chat(old_request))


def test_disconnected_status_has_no_invented_provider_or_model():
    service = ProviderService()
    for status in (service.status(), service.clear()):
        assert not status['configured']
        assert status['preset'] == 'custom'
        assert all(status[field] == '' for field in ('providerName', 'baseUrl', 'model', 'endpoint'))
        assert len(status['presets']) == 2
