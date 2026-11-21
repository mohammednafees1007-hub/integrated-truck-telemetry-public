"""Receipt time is UTC; scheduling/freshness use monotonic clocks."""
import copy, math, time, uuid
from datetime import datetime, timezone

def utc():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def finite(x):
    return type(x) in (int, float) and math.isfinite(x)

def counter(x):
    return type(x) is int and x >= 0

STATES = {'ok','waiting','stale','disconnected','invalid','unconfigured'}

def validate_frame(f):
    if not isinstance(f, dict) or f.get('v') != 1: raise ValueError('frame version')
    if not isinstance(f.get('boot'), str) or not 1 <= len(f['boot']) <= 80: raise ValueError('boot')
    if not all(counter(f.get(k)) for k in ('seq','t_us')): raise ValueError('packet counters')
    i,u,r = f['imu'], f['us'], f['rfid']
    for key, size in [('a',3),('g',3),('q',4)]:
        a=i[key]
        if a is not None and (not isinstance(a,list) or len(a)!=size or not all(finite(v) for v in a)):
            raise ValueError('IMU '+key)
    if i['q'] is not None:
        norm=math.sqrt(sum(v*v for v in i['q']))
        if not 0.8 <= norm <= 1.2: raise ValueError('quaternion norm')
        i['q']=[v/norm for v in i['q']]
    for key in ('n','us','s'):
        if not isinstance(i[key],list) or len(i[key])!=3: raise ValueError('report metadata')
        if any(v is not None and not counter(v) for v in i[key]): raise ValueError('report metadata type')
    for j,k in enumerate(('a','g','q')):
        if i[k] is not None and (i['n'][j] is None or i['us'][j] is None): raise ValueError('missing report time')
        if i[k] is None and (i['n'][j] is not None or i['us'][j] is not None): raise ValueError('metadata without report')
        if i['us'][j] is not None and i['us'][j]>f['t_us']: raise ValueError('future report')
    for section in (i,u,r):
        if section.get('state','waiting') not in STATES: raise ValueError('source state')
    for key in ('mm','echo_us'):
        if u[key] is not None and (not finite(u[key]) or u[key]<=0): raise ValueError('distance')
    if u['mm'] is not None and u['echo_us'] is not None: raise ValueError('ambiguous ultrasonic mode')
    for section,keys in ((u,('n','t_us')),(r,('event','t_us'))):
        for k in keys:
            if section[k] is not None and not counter(section[k]): raise ValueError('source counter')
        if section['t_us'] is not None and section['t_us']>f['t_us']: raise ValueError('future source')
    import re
    if r['uid'] is not None and not re.fullmatch(r'(?:[0-9A-F]{2}){4,10}',r['uid']): raise ValueError('UID')
    if (u['mm'] is not None or u['echo_us'] is not None) and (u['n'] is None or u['t_us'] is None): raise ValueError('water metadata')
    if r['uid'] is not None and (r['event'] is None or r['t_us'] is None): raise ValueError('RFID metadata')
    return f

class State:
    def __init__(self,config):
        self.config=config; self.boot=str(uuid.uuid4()); self.seq=0
        self.connected=False; self.frame=None; self.last_serial=None
        self.esp_boot=None; self.esp_seq=None; self.anchor=None
        self.marks={};self.stamps={};self.seen={};self.gps=None;self.rate_first={};self.rate_last={};self.gps_first=None
        self.metrics=dict(serial_frames=0,serial_gaps=0,invalid=0,duplicates=0,out_of_order=0,restarts=0,backlog_s=0.0,gps_accepted=0,gps_duplicates=0,published=0,missed_deadlines=0,slow_drops=0)
    def ingest(self,f):
        f=validate_frame(copy.deepcopy(f)); now=time.monotonic(); stamp=utc()
        if self.esp_boot == f['boot'] and self.esp_seq is not None:
            if f['seq']<=self.esp_seq:
                self.metrics['duplicates' if f['seq']==self.esp_seq else 'out_of_order']+=1; return False
            if f['t_us'] < self.frame['t_us']: raise ValueError('uptime regression')
            self.metrics['serial_gaps']+=max(0,f['seq']-self.esp_seq-1)
        if self.esp_boot!=f['boot']:
            if self.esp_boot is not None: self.metrics['restarts']+=1
            self.marks={k:v for k,v in self.marks.items() if k=='gps'}
            self.stamps={k:v for k,v in self.stamps.items() if k=='gps'}
            self.seen={};self.rate_first={};self.rate_last={};self.anchor=(now,f['t_us'])
        offset=now-f['t_us']/1e6
        base=self.anchor[0]-self.anchor[1]/1e6
        if offset<base: self.anchor=(now,f['t_us']);base=offset
        self.metrics['backlog_s']=max(0,offset-base)
        # Source age includes held MCU values and observed serial backlog.
        i=f['imu']
        for j,k in enumerate(('linear','gyro','rotation')):
            n=i['n'][j]
            if n is not None and k in self.seen and n<self.seen[k]: raise ValueError('report counter regression')
        for k,section,nkey in [('ultrasonic',f['us'],'n'),('rfid',f['rfid'],'event')]:
            n=section[nkey]
            if n is not None and k in self.seen and n<self.seen[k]: raise ValueError('source counter regression')
        for j,k in enumerate(('linear','gyro','rotation')):
            n=i['n'][j]; us=i['us'][j]
            if n is not None and self.seen.get(k)!=n:
                if k in self.seen and n<self.seen[k]: raise ValueError('report counter regression')
                self.rate_first.setdefault(k,(n,us));self.rate_last[k]=(n,us)
                self.seen[k]=n;self.marks[k]=now-(f['t_us']-us)/1e6-self.metrics['backlog_s'];self.stamps[k]=stamp
        for k,section,nkey in [('ultrasonic',f['us'],'n'),('rfid',f['rfid'],'event')]:
            n=section[nkey]
            if n is not None and n!=self.seen.get(k):
                if k in self.seen and n<self.seen[k]: raise ValueError('source counter regression')
                if section['t_us'] is not None:
                    self.rate_first.setdefault(k,(n,section['t_us']));self.rate_last[k]=(n,section['t_us'])
                self.seen[k]=n
                if section['t_us'] is not None:
                    self.marks[k]=now-(f['t_us']-section['t_us'])/1e6-self.metrics['backlog_s'];self.stamps[k]=stamp
        self.frame=f;self.esp_boot=f['boot'];self.esp_seq=f['seq'];self.last_serial=now
        self.metrics['serial_frames']+=1
        return True
    def add_gps(self,g):
        if self.gps and g['timestamp']<=self.gps['timestamp']:
            if all(g[k]==self.gps[k] for k in ('timestamp','latitude','longitude')):
                self.metrics['gps_duplicates']+=1;return False
            raise ValueError('non-increasing GPS measurement time')
        stamp=utc();now=time.monotonic(); dt=datetime.fromisoformat(g['timestamp'].replace('Z','+00:00'))
        delay=(datetime.now(timezone.utc)-dt).total_seconds()
        self.metrics['gps_delay_s']=delay; self.metrics['gps_clock_skew']=delay < -5
        if delay < -5: raise ValueError('phone time is more than 5 seconds ahead; synchronize clocks')
        self.gps_first=self.gps_first or dt
        self.gps={**g,'received_at':stamp};self.marks['gps']=now-max(0,delay)
        self.metrics['gps_delay_s']=delay; self.metrics['gps_clock_skew']=delay < -5
        self.metrics['gps_accepted']+=1;return True
    def source_rates(self):
        rates={}
        for k,last in self.rate_last.items():
            first=self.rate_first[k];elapsed=(last[1]-first[1])/1e6
            rates[k]=(last[0]-first[0])/elapsed if elapsed>0 else None
        if self.gps and self.gps_first:
            elapsed=(datetime.fromisoformat(self.gps['timestamp'].replace('Z','+00:00'))-self.gps_first).total_seconds()
            rates['gps']=(self.metrics['gps_accepted']-1)/elapsed if elapsed>0 else None
        return rates
    def snapshot(self):
        now=time.monotonic();f=self.frame;i=f['imu'] if f else {}
        def status(key,default='waiting'):
            if key!='gps' and (not self.connected or self.last_serial is None or now-self.last_serial>1): return 'disconnected'
            if default in ('invalid','unconfigured','disconnected'): return default
            if key not in self.marks: return default
            if key!='rfid' and now-self.marks[key]>self.config['freshness'].get('imu' if key in ('linear','gyro','rotation') else key,1): return 'stale'
            return 'ok'
        a=i.get('a') or [None]*3;g=i.get('g') or [None]*3;q=i.get('q') or [None]*4
        ss=[status(k,i.get('state','waiting')) for k in ('linear','gyro','rotation')]
        imu_status=next((s for s in ('disconnected','invalid','unconfigured','waiting','stale') if s in ss),'ok')
        u=f['us'] if f else {};r=f['rfid'] if f else {}
        return dict(schema_version=1,device_id=self.config['device_id'],vehicle_id=self.config['vehicle_id'],boot_id=self.boot,seq=self.seq,timestamp=utc(),
            imu=dict(zip(('lin_accel_x','lin_accel_y','lin_accel_z','gyro_x','gyro_y','gyro_z'),a+g),quaternion=dict(zip('wxyz',q)),received_at=max((self.stamps.get(k,'') for k in ('linear','gyro','rotation')),default='') or None,status=imu_status),
            ultrasonic=dict(distance_mm=u.get('mm'),echo_us=u.get('echo_us'),received_at=self.stamps.get('ultrasonic'),status=status('ultrasonic',u.get('state','waiting'))),
            rfid=dict(card_id=r.get('uid'),last_scan_timestamp=self.stamps.get('rfid') if r.get('uid') else None,status=status('rfid',r.get('state','waiting'))),
            gps=dict(**(self.gps or dict(latitude=None,longitude=None,accuracy_m=None,timestamp=None,received_at=None)),status=status('gps')),
            source=dict(esp_boot_id=self.esp_boot,esp_seq=self.esp_seq,esp_uptime_us=f['t_us'] if f else None,imu_seq=dict(zip(('linear','gyro','rotation'),i.get('n',[None]*3))),imu_sample_us=dict(zip(('linear','gyro','rotation'),i.get('us',[None]*3))),imu_report_status=dict(zip(('linear','gyro','rotation'),i.get('s',[None]*3))),ultrasonic_seq=u.get('n'),ultrasonic_sample_us=u.get('t_us'),rfid_event_seq=r.get('event')))
