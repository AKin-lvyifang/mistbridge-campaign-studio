"""Local credential/session HTTP regressions. No real credentials or network."""
import asyncio
import unittest
import uuid
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from server.app import app
from server.provider import ProviderError

class FakeService:
    configured = False
    def configure(self, config):
        if config['key'] == 'bad':
            raise ValueError('must never return the submitted key: bad')
        self.configured = True
    def clear(self): self.configured = False
    def status(self):
        return {'configured': self.configured, 'key': 'should-never-leak', 'providerName':'Example','baseUrl':'https://api.example.com/v1','endpoint':'https://api.example.com/v1/chat/completions','model':'test-model','preset':'custom','sessionRevision':0,'presets':[{'id':'custom','providerName':'Example','baseUrl':'https://api.example.com/v1','models':['test-model'],'key':'hidden'}]}
    async def chat(self, payload):
        raise ProviderError('Safe provider failure.', 401)

class LuiRouteTests(unittest.TestCase):
    def setUp(self):
        self.service = FakeService()
        self.guard = patch('server.app.lui_service', return_value=self.service)
        self.guard.start()
        self.addCleanup(self.guard.stop)
        self.client = TestClient(app, base_url='http://127.0.0.1:19000')
        self.addCleanup(self.client.close)
    def test_status_is_allowlisted_and_uncached(self):
        response = self.client.get('/api/lui/status')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(response.json()['providerName'],'Example')
        self.assertEqual(response.json()['model'],'test-model')
        self.assertEqual(response.json()['storage'],'session-memory')
        self.assertNotIn('should-never-leak',response.text)
        self.assertNotIn('hidden',response.text)
        self.assertNotIn('key',response.json())
    def test_configure_clear_and_safe_failure(self):
        self.assertEqual(self.client.post('/api/lui/session',json={'key':'synthetic-test-value','providerName':'Example','baseUrl':'https://api.example.com/v1','model':'test-model','preset':'custom'}).status_code,200)
        self.assertTrue(self.client.get('/api/lui/status').json()['configured'])
        failed = self.client.post('/api/lui/session',json={'key':'bad','providerName':'Example','baseUrl':'https://api.example.com/v1','model':'test-model','preset':'custom'})
        self.assertEqual(failed.status_code,422)
        self.assertNotIn('bad',failed.text)
        self.assertNotIn('synthetic',failed.text)
        self.assertEqual(self.client.post('/api/lui/session/clear',json={}).status_code,200)
        self.assertFalse(self.client.get('/api/lui/status').json()['configured'])
    def test_sensitive_routes_inherit_origin_host_and_content_guards(self):
        for path in ['/api/lui/session','/api/lui/session/clear','/api/lui/chat']:
            self.assertEqual(self.client.post(path,json={},headers={'Origin':'https://evil.example'}).status_code,403)
            self.assertEqual(self.client.post(path,json={},headers={'Host':'evil.example'}).status_code,400)
            self.assertEqual(self.client.post(path,content='{}',headers={'Content-Type':'text/plain'}).status_code,415)
    def test_provider_failure_keeps_safe_status(self):
        response=self.client.post('/api/lui/chat',json={'requestId':str(uuid.uuid4())})
        self.assertEqual(response.status_code,401)
        self.assertEqual(response.json(),{'detail':'Safe provider failure.'})
    def test_generic_failure_does_not_leak_exception(self):
        async def failing(_): raise RuntimeError('private upstream details')
        self.service.chat = failing
        response=self.client.post('/api/lui/chat',json={'requestId':str(uuid.uuid4())})
        self.assertEqual(response.status_code,502)
        self.assertNotIn('private',response.text)
    def test_request_shape_and_size_limits(self):
        for body in [[],{'key':'x','extra':1},{'key':123}]:
            self.assertEqual(self.client.post('/api/lui/session',json=body).status_code,422)
        self.assertEqual(self.client.post('/api/lui/session',json={'key':'x'*9000}).status_code,413)
        self.assertEqual(self.client.post('/api/lui/session/clear',json={'key':'x'}).status_code,422)

class LuiCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_request_is_not_queued_and_session_clear_cancels(self):
        service=FakeService()
        started=asyncio.Event(); cancelled=asyncio.Event()
        async def slow(_):
            started.set()
            try: await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled.set(); raise
        service.chat=slow
        with patch('server.app.lui_service',return_value=service), patch('server.app.lui_jobs',asyncio.Semaphore(1)):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1:19000') as client:
                first=asyncio.create_task(client.post('/api/lui/chat',json={'requestId':str(uuid.uuid4())}))
                await asyncio.wait_for(started.wait(),1)
                second=await client.post('/api/lui/chat',json={'requestId':str(uuid.uuid4())})
                self.assertEqual(second.status_code,409)
                self.assertEqual((await client.post('/api/lui/session/clear',json={})).status_code,200)
                self.assertEqual((await first).status_code,499)
                self.assertTrue(cancelled.is_set())

    async def test_explicit_cancel_is_scoped_and_handles_request_reordering(self):
        service=FakeService(); started=asyncio.Event(); cancelled=asyncio.Event()
        async def slow(_):
            started.set()
            try: await asyncio.sleep(10)
            except asyncio.CancelledError: cancelled.set(); raise
        service.chat=slow
        active_id=str(uuid.uuid4()); stale_id=str(uuid.uuid4())
        with patch('server.app.lui_service',return_value=service), patch('server.app.lui_jobs',asyncio.Semaphore(1)):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1:19000') as client:
                first=asyncio.create_task(client.post('/api/lui/chat',json={'requestId':active_id}))
                await asyncio.wait_for(started.wait(),1)
                await client.post('/api/lui/cancel',json={'requestId':stale_id})
                self.assertFalse(cancelled.is_set())
                await client.post('/api/lui/cancel',json={'requestId':active_id})
                self.assertEqual((await first).status_code,499)
                self.assertTrue(cancelled.is_set())
                late=await client.post('/api/lui/chat',json={'requestId':stale_id})
                self.assertEqual(late.status_code,499)

    async def test_cancel_and_session_change_in_registration_gap_start_no_provider(self):
        import importlib
        from fastapi import HTTPException
        api=importlib.import_module('server.app')
        class Request:
            def __init__(self, payload, paused=None, proceed=None):
                self.payload=payload; self.paused=paused; self.proceed=proceed
            async def stream(self):
                import json
                yield json.dumps(self.payload).encode()
            async def is_disconnected(self):
                if self.paused:
                    self.paused.set(); await self.proceed.wait(); self.paused=None
                return False
        for operation in ['cancel','session']:
            paused=asyncio.Event(); proceed=asyncio.Event(); calls=[]
            service=FakeService()
            async def chat(_): calls.append(True); return {}
            service.chat=chat
            request_id=str(uuid.uuid4())
            with patch('server.app.lui_service',return_value=service), patch('server.app.lui_jobs',asyncio.Semaphore(1)):
                task=asyncio.create_task(api.lui_chat(Request({'requestId':request_id},paused,proceed)))
                await asyncio.wait_for(paused.wait(),1)
                if operation=='cancel':
                    await api.cancel_lui_request(Request({'requestId':request_id}))
                else:
                    await api.clear_lui_session(Request({}))
                proceed.set()
                with self.assertRaises(HTTPException) as error: await task
                self.assertEqual(error.exception.status_code,499)
                self.assertEqual(calls,[])
