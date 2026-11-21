import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir','output/synthetic-dist'],{stdio:'inherit',env:{...process.env,APP_BASE_PATH:'/truck-tracking',VITE_LOCAL_MODE:'synthetic'}});
if(result.status!==0)process.exit(result.status||1);
fs.mkdirSync('output/demo-recordings',{recursive:true});
const bundled='../../releases/demo/project-walkthrough.webm';
if(fs.existsSync(bundled)&&!fs.existsSync('output/demo-recordings/project-walkthrough.webm'))fs.copyFileSync(bundled,'output/demo-recordings/project-walkthrough.webm');
