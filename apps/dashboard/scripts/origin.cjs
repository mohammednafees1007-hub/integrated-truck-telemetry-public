const fs=require('node:fs');
const origin=process.argv[2];
if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin||'')) throw Error('Pass the actual printed temporary HTTPS origin');
let env=fs.readFileSync('.env','utf8');env=env.replace(/^PUBLIC_ORIGIN=.*$/m,'PUBLIC_ORIGIN='+origin);fs.writeFileSync('.env',env,{mode:0o600});
const c=Object.fromEntries(env.split(/\r?\n/).filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const link=origin+'/truck-tracking/pi-gps/pair.html#token='+c.PHONE_WRITE_KEY;
const apk=origin+'/truck-tracking/pi-gps/PiGPS.apk';
fs.writeFileSync('.private/PHONE_PAIRING.html',`<!doctype html><meta name="referrer" content="no-referrer"><title>Private phone pairing</title><h1>Private phone pairing</h1><p>1. Download and install <a href="${apk}">Pi GPS Sender APK</a> on your phone.</p><p>2. Open this private link on the phone (contains your write key; keep it private):</p><p><a href="${link}">${link}</a></p><p>3. Tap Pair installed app. Pairing fills settings; it does not start sharing.</p><p>4. Grant precise location and notifications, connect the GPS phone to configured hotspot or mobile data, enable GPS and press Start outdoors. Stop with the notification.</p><p>Use Truck-Tracking.bat to check the Pi bridge and current laptop address. Pi confirmation appears after a fresh phone fix reaches it.</p>`,{mode:0o600});
fs.writeFileSync('.private/pi-config.json',JSON.stringify({public_origin:origin,base_path:'/truck-tracking',device_key:c.PI_DEVICE_KEY,reader_key:c.PI_READER_KEY},null,2),{mode:0o600});
console.log('Public origin updated; private phone pairing and Pi config prepared. Restart backend if running.');
require('qrcode').toDataURL(link,{width:420,margin:2}).then(data=>{
  const file='.private/PHONE_PAIRING.html';
  let html=fs.readFileSync(file,'utf8');html=html.replace('<h1>Private phone pairing</h1>','<h1>Private phone pairing</h1><p>After installing the APK, scan this QR with your phone camera to open private pairing.</p><img alt="Private phone pairing QR; keep private" src="'+data+'">');fs.writeFileSync(file,html,{mode:0o600});
});
