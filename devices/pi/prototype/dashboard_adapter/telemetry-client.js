// Import into nexmei once repository access is available. No demo fallback.
export class TelemetryClient {
  constructor({sensorUrl, fatigueUrl, onSensors, onFatigue, onStatus}) {
    Object.assign(this,{sensorUrl,fatigueUrl,onSensors,onFatigue,onStatus});
    this.stopped=true; this.sockets=[]; this.timers=new Set(); this.generation=0;
  }
  start() { if(!this.stopped)return; this.generation++;this.stopped=false; this.connect(this.sensorUrl,this.onSensors,'sensors'); if(this.fatigueUrl)this.connect(this.fatigueUrl,this.onFatigue,'fatigue'); }
  connect(url,callback,source) {
    if(this.stopped)return;
    const generation=this.generation;const ws=new WebSocket(url);this.sockets.push(ws);
    ws.onopen=()=>this.onStatus?.(source,'connected');
    ws.onmessage=e=>{if(generation!==this.generation)return;try{callback?.(JSON.parse(e.data));}catch(err){this.onStatus?.(source,'invalid');}};
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{this.sockets=this.sockets.filter(s=>s!==ws);this.onStatus?.(source,'disconnected');if(!this.stopped && generation===this.generation){const timer=setTimeout(()=>{this.timers.delete(timer);this.connect(url,callback,source);},2000);this.timers.add(timer);}};
  }
  stop(){this.stopped=true;this.generation++;this.timers.forEach(clearTimeout);this.timers.clear();this.sockets.forEach(s=>s.close());this.sockets=[];}
}
export function deriveSnapshot(p, drivers={}) {
  const i=p.imu,q=i.quaternion;let orientation=null;
  // Sensor-frame aerospace ZYX Euler in degrees. Vehicle mounting is unconfigured.
  if(i.status==='ok' && Object.values(q).every(Number.isFinite)) {
    const {w,x,y,z}=q, deg=180/Math.PI;
    orientation={roll:Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y))*deg,pitch:Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x))))*deg,yaw:Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))*deg,frame:'sensor; vehicle alignment pending'};
  }
  const u=p.ultrasonic;
  const distance_mm=u.status==='ok'?(u.distance_mm??(u.echo_us==null?null:u.echo_us*0.343/2)):null;
  return {raw:p,orientation,water:{distance_mm,depth_mm:null,percent:null,volume_l:null,status:distance_mm===null?u.status:'setup_required'},driver:{uid:p.rfid.card_id,name:drivers[p.rfid.card_id]??'Unknown driver',lastScan:p.rfid.last_scan_timestamp},gyro_deg_s:i.status==='ok'?[i.gyro_x,i.gyro_y,i.gyro_z].map(v=>v*180/Math.PI):null};
}
export class SessionRoute {
  constructor({maxAccuracyM=50,maxGapS=5,maxSpeedMps=60}={}){Object.assign(this,{maxAccuracyM,maxGapS,maxSpeedMps});this.previous=null;this.distance_m=0;this.points=[];this.lastTime=null;}
  update(g) {
    if(g.status!=='ok'){this.previous=null;return null;}
    const t=Date.parse(g.timestamp);
    if(!Number.isFinite(t)||t<=this.lastTime)return null;
    this.lastTime=t;
    if(g.accuracy_m>this.maxAccuracyM){this.previous=null;return null;}
    let speed=null;
    if(this.previous){
      const a=this.previous,dt=(t-a.t)/1000,rad=Math.PI/180;
      const h=Math.sin((g.latitude-a.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(g.latitude*rad)*Math.sin((g.longitude-a.longitude)*rad/2)**2;
      const d=6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
      if(dt<=this.maxGapS && d/dt<=this.maxSpeedMps && d>Math.max(a.accuracy_m,g.accuracy_m)){this.distance_m+=d;speed=d/dt;}
    }
    this.previous={...g,t};this.points.push([g.latitude,g.longitude]);if(this.points.length>3600)this.points.shift();
    return {distance_m:this.distance_m,speed_m_s:speed,scope:'session',points:this.points};
  }
}
