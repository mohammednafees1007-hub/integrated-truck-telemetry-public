#!/usr/bin/env python3
"""Install official current classic-ESP32 build assets only, verifying index SHA256.
Avoids downloading unrelated RISC-V/other-board SDKs on this single-board Pi.
Arduino CLI core install was attempted first but its release request timed out.
"""
import hashlib,json,pathlib,subprocess,tarfile,zipfile,shutil
root=pathlib.Path(__file__).resolve().parents[1]
index=pathlib.Path.home()/'.arduino15/package_esp32_index.json'
p=json.loads(index.read_text())['packages'][0];version='3.3.12'
platform=next(x for x in p['platforms'] if x['version']==version)
base=pathlib.Path.home()/'.arduino15/packages/esp32'
assets=[('core',platform,pathlib.Path('/tmp/prototype-core.zip'),base/'hardware/esp32'/version)]
for name,file in [('esp-x32','/tmp/prototype-compiler.tar.gz'),('esp32-libs','/tmp/prototype-sdk.zip')]:
 dep=next(x for x in platform['toolsDependencies'] if x['name']==name)
 t=next(x for x in p['tools'] if x['name']==name and x['version']==dep['version'])
 a=next(x for x in t['systems'] if x['host'] in ('aarch64-linux-gnu','all','any'))
 assets.append((name,a,pathlib.Path(file),base/'tools'/name/dep['version']))
for name,asset,file,dest in assets:
 record=root/'build/toolchain-install.json'
 if dest.exists() and record.exists():
  installed=json.loads(record.read_text())
  if any(a['name']==name and a['sha256']==asset['checksum'] and a['path']==str(dest) for a in installed['assets']):
   print(name,'already installed',flush=True);continue
 if not file.exists() or file.stat().st_size!=int(asset['size']):
  subprocess.run(['curl','-fL','--connect-timeout','15','--max-time','1800','--retry','2','-o',str(file),asset['url']],check=True)
 digest=hashlib.file_digest(file.open('rb'),'sha256').hexdigest()
 if digest!=asset['checksum'].split(':')[1]:raise RuntimeError('Checksum mismatch: '+name)
 stage=root/'build'/('extract-'+name)
 stage.mkdir(exist_ok=True)
 if file.suffix=='.zip':
  with zipfile.ZipFile(file) as z:z.extractall(stage)
 else:
  with tarfile.open(file) as t:t.extractall(stage,filter='data')
 items=list(stage.iterdir());source=items[0] if len(items)==1 and items[0].is_dir() else stage
 dest.parent.mkdir(parents=True,exist_ok=True)
 if dest.exists():raise RuntimeError('Existing destination: '+str(dest))
 shutil.move(str(source),str(dest))
 if stage.exists():shutil.rmtree(stage)
 print(name,digest,dest,flush=True)
# Python esptool is installed in our venv; platform invokes this executable path.
esp=base/'tools/esptool_py/5.3.1';esp.mkdir(parents=True,exist_ok=True)
(esp/'esptool').write_text('#!/bin/sh\nexec "'+str(root.parent/'.venv/bin/python')+'" -m esptool "$@"\n');(esp/'esptool').chmod(0o755)
(root/'build/toolchain-install.json').write_text(json.dumps({'platform':version,'assets':[{'name':n,'sha256':a['checksum'],'path':str(d)} for n,a,f,d in assets],'esptool':'venv esptool wrapper; version in firmware-versions.txt'},indent=2))
