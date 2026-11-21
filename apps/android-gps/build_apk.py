#!/usr/bin/env python3
"""Build native Java APK on the Pi using official SDK jars and Debian ARM tools."""
from pathlib import Path
import os,subprocess,secrets,zipfile,hashlib,json
ROOT=Path(__file__).resolve().parent;TOOLS=ROOT/'tools';HOST=TOOLS/'host';JDK=HOST/'usr/lib/jvm/java-21-openjdk-arm64'
env=os.environ.copy();env['JAVA_HOME']=str(JDK);env['LD_LIBRARY_PATH']=str(HOST/'usr/lib/aarch64-linux-gnu/android')+':'+str(HOST/'usr/lib/aarch64-linux-gnu')+':'+str(HOST/'usr/lib')
ANDROID=TOOLS/'platform/android-35/android.jar';BT=TOOLS/'buildtools/android-15';BUILD=ROOT/'build';BUILD.mkdir(exist_ok=True)
def run(*args):subprocess.run([str(a) for a in args],env=env,cwd=ROOT,check=True)
classes=BUILD/'classes';dex=BUILD/'dex';classes.mkdir(exist_ok=True);dex.mkdir(exist_ok=True)
run(JDK/'bin/javac','-encoding','UTF-8','-source','8','-target','8','-classpath',ANDROID,'-d',classes,*sorted((ROOT/'src').rglob('*.java')))
run(JDK/'bin/java','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--lib',ANDROID,'--min-api','26','--output',dex,*sorted(classes.rglob('*.class')))
run(HOST/'usr/bin/aapt2','link','-I',TOOLS/'platform33/android.jar','--manifest',ROOT/'AndroidManifest.xml','-o',BUILD/'resources.apk','--min-sdk-version','26','--target-sdk-version','35')
import shutil
shutil.copyfile(BUILD/'resources.apk',BUILD/'unsigned.apk')
with zipfile.ZipFile(BUILD/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as z:
 for p in dex.glob('*.dex'):z.write(p,p.name)
run(HOST/'usr/bin/zipalign','-f','4',BUILD/'unsigned.apk',BUILD/'aligned.apk')
signing=ROOT/'signing';signing.mkdir(exist_ok=True,mode=0o700);password=signing/'password';keystore=signing/'pigps.p12'
if not password.exists():password.write_text(secrets.token_urlsafe(32));password.chmod(0o600)
if not keystore.exists():
 run(JDK/'bin/keytool','-genkeypair','-alias','pigps','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Pi GPS Prototype','-storetype','PKCS12','-keystore',keystore,'-storepass:file',password)
 keystore.chmod(0o600)
run(JDK/'bin/java','-jar',BT/'lib/apksigner.jar','sign','--ks',keystore,'--ks-pass','file:'+str(password),'--ks-key-alias','pigps','--out',BUILD/'PiGPS.apk',BUILD/'aligned.apk')
run(JDK/'bin/java','-jar',BT/'lib/apksigner.jar','verify','--verbose','--print-certs',BUILD/'PiGPS.apk')
run(HOST/'usr/bin/aapt2','dump','badging',BUILD/'PiGPS.apk')
sha=hashlib.file_digest((BUILD/'PiGPS.apk').open('rb'),'sha256').hexdigest();(BUILD/'PiGPS.apk.sha256').write_text(sha+'  PiGPS.apk\n')
(BUILD/'build-metadata.json').write_text(json.dumps({'application_id':'com.prototype.pigps','version':'1.0','min_sdk':26,'target_sdk':35,'sdk_platform':'android-35_r02','sdk_buildtools':'35.0.0','java':'Debian OpenJDK 21 ARM64','sha256':sha,'bytes':(BUILD/'PiGPS.apk').stat().st_size,'runtime_verification':'Not installed on a phone yet'},indent=2)+'\n')
print('APK:',BUILD/'PiGPS.apk');print('SHA256:',sha)
