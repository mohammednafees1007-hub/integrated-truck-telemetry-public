import unittest
import httpx
from bridge import Bridge

CONFIG = {'public_origin': 'https://test.example', 'device_key': 'd'*43, 'reader_key': 'r'*43}
FIX = {'latitude': 12.0, 'longitude': 77.0, 'accuracy_m': 3.0, 'timestamp': '2026-01-01T00:00:00Z'}

class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, status, body, held=None, ack_failure=False):
        remote_calls, local_calls = [], []
        async def remote_handler(request):
            remote_calls.append(request.url.path)
            self.assertNotIn('d'*43, str(request.url))
            if request.url.path.endswith('latest.php'):
                return httpx.Response(200, json={'schema_version':1,'stream_id':'a'*32,'seq':1,'fix':FIX,'relay_received_at':'2026-01-01T00:00:01Z'})
            if ack_failure:
                return httpx.Response(503, json={'error':'unavailable'})
            return httpx.Response(200, json={'acknowledged':True,'pi_last_ack_seq':1,'pi_last_ack_timestamp':'2026-01-01T00:00:02Z'})
        async def local_handler(request):
            local_calls.append(request.url.path)
            self.assertNotIn('X-GPS-Key', request.headers)
            if request.method=='GET':
                return httpx.Response(200, json={'gps':held or FIX})
            return httpx.Response(status, json=body)
        bridge=Bridge(CONFIG)
        async with httpx.AsyncClient(transport=httpx.MockTransport(remote_handler)) as remote, httpx.AsyncClient(transport=httpx.MockTransport(local_handler)) as local:
            try:
                await bridge.gps_step(remote,local)
            except (ValueError,httpx.HTTPError):
                pass
            count=len(local_calls)
            if status==200 and type(body.get('accepted')) is bool and not held and not ack_failure:
                await bridge.gps_step(remote,local)
                self.assertEqual(count,len(local_calls),'Duplicate relay fix should not re-forward')
        return bridge,remote_calls,local_calls

    async def test_valid_receipt_acknowledges(self):
        b,r,l=await self.scenario(200,{'accepted':True})
        self.assertEqual(b.acked,('a'*32,1));self.assertEqual(sum(x.endswith('ack.php') for x in r),1)
        self.assertIsNotNone(b.receipt['pi_local_accepted_at'])

    async def test_409_never_acknowledges(self):
        b,r,l=await self.scenario(409,{'accepted':False})
        self.assertIsNone(b.acked);self.assertFalse(any(x.endswith('ack.php') for x in r))

    async def test_bad_receipts_never_acknowledge(self):
        for status,body in [(200,{'accepted':'true'}),(200,{}),(201,{'accepted':True}),(500,{'accepted':True})]:
            b,r,l=await self.scenario(status,body)
            self.assertIsNone(b.acked);self.assertFalse(any(x.endswith('ack.php') for x in r))

    async def test_valid_duplicate_is_checked_and_acknowledged(self):
        b,r,l=await self.scenario(200,{'accepted':False})
        self.assertEqual(b.acked,('a'*32,1));self.assertIn('/api/v1/sensors/latest',l)

    async def test_mismatching_duplicate_never_acknowledged(self):
        b,r,l=await self.scenario(200,{'accepted':False},held={**FIX,'latitude':13})
        self.assertIsNone(b.acked);self.assertFalse(any(x.endswith('ack.php') for x in r))

    async def test_ack_failure_retains_receipt_for_retry(self):
        b,r,l=await self.scenario(200,{'accepted':True},ack_failure=True)
        self.assertIsNotNone(b.delivered);self.assertIsNone(b.acked)

    async def test_silent_gateway_does_not_upload_heartbeat(self):
        b=Bridge(CONFIG);b.sensors={'old':True};b.sensor_seen=0
        async def handler(request):self.fail('Silent gateway uploaded stale heartbeat')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as remote:
            await b.upload_step(remote)

    async def test_camera_startup_cannot_poison_sensor_uploads(self):
        b=Bridge(CONFIG)
        async def handler(request):
            return httpx.Response(200,json={'schema_version':1,'status':'unconfigured','results':None})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as local:
            await b.camera_step(local)
        self.assertEqual(b.camera['status'],'unavailable')
        self.assertIsNone(b.camera['results'])

    async def test_jpeg_upload_uses_async_compatible_bytes(self):
        b=Bridge(CONFIG);b.camera={'status':'no_face'}
        jpeg=bytes.fromhex('ffd8010203ffd9');uploaded=[]
        async def local_handler(request):
            return httpx.Response(200,content=jpeg,headers={'Content-Type':'image/jpeg'})
        async def remote_handler(request):
            uploaded.append(await request.aread())
            self.assertEqual(request.headers['content-type'],'image/jpeg')
            return httpx.Response(200,json={'accepted':True})
        async with httpx.AsyncClient(transport=httpx.MockTransport(remote_handler)) as remote, httpx.AsyncClient(transport=httpx.MockTransport(local_handler)) as local:
            await b.jpeg_step(remote,local)
        self.assertEqual(uploaded,[jpeg])

    async def test_rejects_insecure_or_credential_urls(self):
        for value in ['http://test.example','https://user:pass@test.example','https://test.example?key=foo','https://test.example/path']:
            with self.assertRaises(ValueError):Bridge({**CONFIG,'public_origin':value})

if __name__=='__main__': unittest.main()
