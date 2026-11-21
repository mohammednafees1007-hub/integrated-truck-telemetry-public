from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess,json
p=json.loads((Path.home()/'.arduino15/package_esp32_index.json').read_text())['packages'][0]
a=p['platforms'][0];tasks=[('core','/tmp/prototype-core.zip',a)]
for name,file in [('esp-x32','/tmp/prototype-compiler.tar.gz'),('esp32-libs','/tmp/prototype-sdk.zip')]:
 d=next(x for x in a['toolsDependencies'] if x['name']==name)
 t=next(x for x in p['tools'] if x['name']==name and x['version']==d['version'])
 s=next(x for x in t['systems'] if x['host'] in ('aarch64-linux-gnu','all','any'))
 tasks.append((name,file,s))
def run(task):
 name,file,asset=task
 if Path(file).stat().st_size==int(asset['size']):return
 with open('prototype/build/'+name+'-resume.log','w') as log:
  subprocess.run(['curl','-fL','-C','-','--connect-timeout','15','--max-time','2400','--retry','3','--retry-all-errors','-o',file,asset['url']],stdout=log,stderr=log,check=True)
 print(name,'download complete',flush=True)
with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(run,tasks))
