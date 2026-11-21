const fs=require('node:fs'), crypto=require('node:crypto');
if(fs.existsSync('.env')) throw Error('Existing configuration preserved');
const keys=['PHONE_WRITE_KEY','PI_READER_KEY','PI_DEVICE_KEY','BROWSER_PASSWORD','SESSION_SECRET'];
const config=Object.fromEntries(keys.map(k=>[k,crypto.randomBytes(32).toString('base64url')]));
fs.mkdirSync('.private',{recursive:true});
fs.writeFileSync('.env','APP_BASE_PATH=/truck-tracking\nPORT=3000\nPUBLIC_ORIGIN=\nDATA_DIR=.private/data\n'+keys.map(k=>k+'='+config[k]).join('\n')+'\n',{mode:0o600});
fs.writeFileSync('.private/ACCESS.md','# Private laptop access\n\nLocal dashboard: http://localhost:3000/truck-tracking/\n\nBrowser password: '+config.BROWSER_PASSWORD+'\n\nKeep this file private. Machine keys are in .env; do not paste them into chat or GitHub.\n',{mode:0o600});
console.log('Random scoped keys generated in private configuration. No secrets printed.');
