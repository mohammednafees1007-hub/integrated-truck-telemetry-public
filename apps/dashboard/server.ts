import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import {Relay, safeEqual, requireThat, writeJson} from './backend/relay';
import {validatePi,adaptPi} from './backend/pi';
dotenv.config({quiet:true});

export function createApp(env=process.env) {
  const base=env.APP_BASE_PATH || '/truck-tracking';
  requireThat(/^\/[a-z0-9-]+$/.test(base),500,'Invalid APP_BASE_PATH');
  for(const key of ['PHONE_WRITE_KEY','PI_READER_KEY','PI_DEVICE_KEY','BROWSER_PASSWORD','SESSION_SECRET']) requireThat(/^[\w-]{32,128}$/.test(env[key]||''),500,`Configure ${key} with a random 32-128 character secret`);
  requireThat(new Set(['PHONE_WRITE_KEY','PI_READER_KEY','PI_DEVICE_KEY'].map(k=>env[k])).size===3,500,'Use distinct machine keys');
  const dir=path.resolve(env.DATA_DIR || '.private/data'); fs.mkdirSync(dir,{recursive:true});
  const relay=new Relay(path.join(dir,'relay.json'));
  const load=(name:string,defaultValue:any)=>fs.existsSync(path.join(dir,name))?JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')):defaultValue;
  let persisted=load('pi.json',{latest:null,received_at:null,boots:{}});
  let drivers=load('drivers.json',[{id:'ganash',name:'ganash',rfidId:'A1B2C3D4',rfidUid:'A1B2C3D4',phone:'',status:'Inactive',licenseNumber:'',experienceYears:null,joinedDate:'',totalTrips:null,safetyScore:null}]);
  let settings=load('settings.json',{});
  let image:Buffer|null=null, imageTime=0;
  const app=express(), router=express.Router();
  app.disable('x-powered-by'); app.set('trust proxy','loopback');
  app.use((_req,res,next)=>{res.set({'Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','X-Frame-Options':'DENY'}); next();});
  const route=(handler:any)=>(req:any,res:any,next:any)=>{try{Promise.resolve(handler(req,res)).catch(next);}catch(e){next(e);}};
  const json=express.json({limit:4096,strict:true});
  const key=(name:string)=>(req:any,res:any,next:any)=> {
    const value=req.get('X-GPS-Key') || req.get('X-Device-Token') || req.get('Authorization')?.replace(/^Bearer /,'') || '';
    return safeEqual(value,env[name]!) ? next() : res.status(401).json({error:'Unauthorized'});
  };
  const sessionCookie=(req:any)=>String(req.headers.cookie||'').split(';').map((x:string)=>x.trim()).find((x:string)=>x.startsWith('truck_session='))?.slice(14)||'';
  const sessionValid=(req:any)=>{
    const [expires,nonce,signature]=sessionCookie(req).split('.');
    return Number(expires)>Date.now() && Number(expires)<Date.now()+13*3600000 && nonce && signature && safeEqual(signature,crypto.createHmac('sha256',env.SESSION_SECRET!).update(expires+'.'+nonce).digest('hex'));
  };
  const browser=(req:any,res:any,next:any)=>sessionValid(req)?next():req.path.startsWith('/api/')?res.status(401).json({error:'Login required'}):res.redirect(base+'/login');
  router.get('/pi-gps/health.php',(_req,res)=>res.json({service:'pi-gps-relay',schema_version:1,status:'ready'}));
  router.get('/pi-gps/PiGPS.apk',(_req,res)=>res.type('application/vnd.android.package-archive').sendFile(path.resolve('private-assets/PiGPS.apk')));
  router.get('/pi-gps/pair.html',(_req,res)=>res.type('html').send(`<!doctype html><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title>Pair phone GPS</title><body style="font:18px system-ui;padding:32px"><h1>Pair phone GPS</h1><p><a href="PiGPS.apk">Download APK</a></p><p id="endpoint"></p><a id="pair">Open your private setup link first</a><p>Pairing only fills settings. Press Start yourself, outdoors with phone Wi-Fi off. Stop using the notification. Do not share the private setup link.</p><script>const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);const endpoint=location.origin+location.pathname.replace(/pair.html$/,'ingest.php');document.getElementById('endpoint').textContent=endpoint;if(token && /^[A-Za-z0-9_-]{32,128}$/.test(token)){const a=document.getElementById('pair');a.href='pigps://pair?endpoint='+encodeURIComponent(endpoint)+'&token='+encodeURIComponent(token);a.textContent='Pair installed app';}</script></body>`));
  router.post('/pi-gps/ingest.php',key('PHONE_WRITE_KEY'),json,route((req:any,res:any)=>res.json(relay.ingest(req.body))));
  router.get('/pi-gps/latest.php',key('PI_READER_KEY'),(_req,res)=>res.json(relay.latest()));
  router.post('/pi-gps/ack.php',key('PI_READER_KEY'),json,route((req:any,res:any)=>res.json(relay.ack(req.body))));
  router.get('/pi-gps/status.php',key('PHONE_WRITE_KEY'),(_req,res)=>res.json({stored_by_relay:true,latest_seq:relay.state.seq,...relay.info()}));
  router.post('/api/pi/telemetry',key('PI_DEVICE_KEY'),express.json({limit:'128kb'}),route((req:any,res:any)=>{
    const p=validatePi(req.body), boots=persisted.boots;
    if(boots[p.bridge_boot_id]) requireThat(persisted.latest?.bridge_boot_id===p.bridge_boot_id && p.bridge_seq>boots[p.bridge_boot_id],409,'Replay or retired bridge boot');
    requireThat(Object.keys(boots).length<10000 || boots[p.bridge_boot_id],409,'Rotate device identity after 10000 boots');
    boots[p.bridge_boot_id]=p.bridge_seq;
    persisted={latest:p,received_at:new Date().toISOString(),boots};
    writeJson(path.join(dir,'pi.json'),persisted); res.json({accepted:true,bridge_seq:p.bridge_seq});
  }));
  router.post('/api/pi/camera',key('PI_DEVICE_KEY'),express.raw({type:'image/jpeg',limit:'512kb'}),route((req:any,res:any)=>{
    requireThat(Buffer.isBuffer(req.body) && req.body.length>=4 && req.body[0]===255 && req.body[1]===216 && req.body.at(-2)===255 && req.body.at(-1)===217,400,'Invalid JPEG');
    requireThat(['ok','no_face'].includes(adaptPi(persisted.latest,persisted.received_at,drivers)?.camera?.status),409,'Camera not active');
    image=Buffer.from(req.body); imageTime=Date.now();res.json({accepted:true});
  }));
  router.get('/login',(_req,res)=>res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Truck dashboard sign in</title><body style="background:#0f172a;color:white;font:18px system-ui;padding:40px"><h1>Truck dashboard</h1><form method="post" action="${base}/login"><label>Password <input name="password" type="password" required autocomplete="current-password"></label><button>Sign in</button></form></body>`));
  const failures=new Map<string,{count:number,start:number}>();
  router.post('/login',express.urlencoded({extended:false,limit:4096}),route((req:any,res:any)=>{
    const ip=req.ip || 'unknown', now=Date.now();
    if(failures.size>1000) for(const [k,v] of failures) if(now-v.start>900000) failures.delete(k);
    requireThat(failures.size<=1000 || failures.has(ip),429,'Login temporarily rate limited');
    const f=failures.get(ip) || {count:0,start:now}; if(now-f.start>900000){f.count=0;f.start=now;}
    requireThat(f.count<10,429,'Too many attempts. Retry after 15 minutes');
    if(!safeEqual(String(req.body.password||''),env.BROWSER_PASSWORD!)){f.count++;failures.set(ip,f);return res.status(401).send('Incorrect password');}
    failures.delete(ip);const value=(now+12*3600000)+'.'+crypto.randomBytes(24).toString('hex');
    const secure=req.secure || req.get('X-Forwarded-Proto')==='https';
    res.setHeader('Set-Cookie',`truck_session=${value}.${crypto.createHmac('sha256',env.SESSION_SECRET!).update(value).digest('hex')}; Path=${base}; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`);
    res.redirect(base+'/');
  }));
  router.use(browser);
  router.use((req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin=req.get('Origin');
      if(!origin || new URL(origin).host!==req.get('Host')) return res.status(403).json({error:'Same-origin request required'});
    } next();
  });
  const latest=()=>adaptPi(persisted.latest,persisted.received_at,drivers);
  router.get('/api/pi/latest',(_req,res)=>res.json({latest:latest(),relay:relay.latest(),ack:relay.info()}));
  router.get('/api/sensors/latest',(_req,res)=>res.json({latest:latest(),relay:relay.latest(),ack:relay.info()}));
  router.get('/api/sensors/history',(_req,res)=>res.json({history:[],events:[],retention:'Latest-only test; route history disabled'}));
  router.get('/api/telemetry/latest',(_req,res)=>res.json({latest:latest()}));
  router.get('/api/status',(_req,res)=>res.json({connected:latest()?.transport_status==='connected',mode:'PI_LIVE',received_at:persisted.received_at}));
  router.get('/api/model/status',(_req,res)=>{const online=['ok','no_face'].includes(latest()?.camera?.status);res.json({online,status:online?'CONNECTED':'DISCONNECTED',engine:'RASPBERRY_PI_ONNX'});});
  router.get('/api/camera/latest',(_req,res)=>image && Date.now()-imageTime<2500 && ['ok','no_face'].includes(latest()?.camera?.status)?res.type('image/jpeg').send(image):res.status(503).json({error:'Pi camera unavailable'}));
  router.get('/api/drivers',(_req,res)=>res.json(drivers));
  router.put('/api/drivers',express.json({limit:'64kb'}),route((req:any,res:any)=>{
    requireThat(Array.isArray(req.body) && req.body.length<=1000 && req.body.every((d:any)=>typeof d.id==='string' && typeof d.name==='string' && d.name.length<=120 && typeof (d.rfidUid||d.rfidId)==='string' && /^(?:[0-9A-Fa-f]{2}){4,10}$/.test(d.rfidUid||d.rfidId)));
    drivers=req.body; writeJson(path.join(dir,'drivers.json'),drivers);res.json({saved:true});
  }));
  router.get('/api/settings',(_req,res)=>res.json(settings));
  router.put('/api/settings',express.json({limit:'256kb'}),route((req:any,res:any)=>{requireThat(req.body && typeof req.body==='object' && !Array.isArray(req.body));settings={...settings,...req.body};writeJson(path.join(dir,'settings.json'),settings);res.json({saved:true});}));
  router.get('/api/setup/qr',route(async (_req:any,res:any)=>{
    requireThat(/^https:\/\//.test(env.PUBLIC_ORIGIN || ''),503,'Public origin not configured');
    const link=(env.PUBLIC_ORIGIN || '')+base+'/pi-gps/pair.html#token='+env.PHONE_WRITE_KEY;
    res.type('image/png').send(await QRCode.toBuffer(link,{width:420,margin:2}));
  }));
  router.get('/api/setup',(_req,res)=>res.json({endpoint:(env.PUBLIC_ORIGIN || '')+base+'/pi-gps/ingest.php',pairing_link:`pigps://pair?endpoint=${encodeURIComponent((env.PUBLIC_ORIGIN || '')+base+'/pi-gps/ingest.php')}&token=${env.PHONE_WRITE_KEY}`}));
  router.get('/pi-gps/',(_req,res)=>res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Phone GPS setup</title><body style="font:18px system-ui;padding:32px"><h1>Phone GPS setup</h1><p>Scan this private QR on your phone after installing the APK. Keep it private.</p><img src="../api/setup/qr" alt="Private phone pairing QR" width="420"><p><a href="PiGPS.apk">Download Pi GPS Sender APK</a></p><p id="endpoint"></p><a id="pair">Pair installed app</a><p>Pairing does not start tracking. Grant precise location and notifications, connect through the configured hotspot or mobile data, then press Start outdoors. Use the notification Stop action to stop sharing.</p><script>history.replaceState(null,'',location.pathname);fetch('../api/setup').then(r=>r.json()).then(s=>{document.getElementById('endpoint').textContent=s.endpoint;document.getElementById('pair').href=s.pairing_link})</script></body>`));
  router.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint disabled in Pi mode'}));
  router.use((req,res,next)=>/server\.cjs(?:\.map)?$/.test(req.path)?res.sendStatus(404):next());
  router.use(express.static(path.resolve('dist'),{index:false,dotfiles:'deny'}));
  router.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
  app.use(base,router);
  app.use((_req,res)=>res.status(404).json({error:'Use '+base+'/'}));
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status||500).json({error:err.status===500?'Server error':err.status?err.message:'Server error'}));
  return app;
}
if(!process.env.TEST_MODE) createApp().listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Dashboard ready at http://localhost:'+(process.env.PORT||3000)+(process.env.APP_BASE_PATH||'/truck-tracking')+'/'));
