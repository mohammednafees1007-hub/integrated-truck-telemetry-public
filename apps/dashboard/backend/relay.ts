import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function requireThat(ok: unknown, status = 400, message = 'Invalid request'): asserts ok { if (!ok) throw new HttpError(status, message); }
export const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function exact(body: any, keys: string[]) { requireThat(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).sort().join() === [...keys].sort().join()); }
export function timestamp(value: any) {
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)));
  const y=Number(value.slice(0,4)),m=Number(value.slice(5,7)),d=Number(value.slice(8,10));
  const days=[31,(y%4===0 && (y%100!==0 || y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
  requireThat(m>=1 && m<=12 && d>=1 && d<=days[m-1] && Number(value.slice(11,13))<24 && Number(value.slice(14,16))<60 && Number(value.slice(17,19))<60);
  return Date.parse(value);
}
export function gpsFix(body: any, now = Date.now()) {
  exact(body, ['latitude','longitude','accuracy_m','timestamp']);
  requireThat(finite(body.latitude) && Math.abs(body.latitude) <= 90 && finite(body.longitude) && Math.abs(body.longitude) <= 180 && finite(body.accuracy_m) && body.accuracy_m >= 0);
  requireThat(timestamp(body.timestamp) <= now + 5000, 409, 'Future source time');
  return body;
}
export function safeEqual(a: string, b: string) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
}
export function writeJson(file: string, value: any) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
}
export class Relay {
  state: any;
  constructor(private file: string) {
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {schema_version:1,stream_id:crypto.randomBytes(16).toString('hex'),seq:0,fix:null,relay_received_at:null,pi_last_ack_seq:null,pi_last_ack_timestamp:null};
  }
  info(now = Date.now()) { return {pi_last_ack_seq:this.state.pi_last_ack_seq,pi_last_ack_timestamp:this.state.pi_last_ack_timestamp,pi_ack_age_s:this.state.pi_last_ack_timestamp ? Math.max(0,(now-Date.parse(this.state.pi_last_ack_timestamp))/1000) : null}; }
  ingest(body: any, now = Date.now()) {
    gpsFix(body, now);
    const previous = this.state.fix;
    const duplicate = previous && ['latitude','longitude','accuracy_m','timestamp'].every(k=>previous[k]===body[k]);
    if (!duplicate) {
      requireThat(!previous || timestamp(body.timestamp)>timestamp(previous.timestamp),409,'Source time must increase');
      this.state = {...this.state,seq:this.state.seq+1,fix:body,relay_received_at:new Date(now).toISOString()};
      writeJson(this.file,this.state);
    }
    return {accepted:!duplicate,stored_by_relay:true,seq:this.state.seq,...this.info(now)};
  }
  latest() { return this.state.fix ? {schema_version:1,stream_id:this.state.stream_id,seq:this.state.seq,fix:this.state.fix,relay_received_at:this.state.relay_received_at} : {schema_version:1,status:'waiting',fix:null}; }
  ack(body: any, now = Date.now()) {
    exact(body,['stream_id','seq']);
    requireThat(body.stream_id===this.state.stream_id && Number.isSafeInteger(body.seq) && body.seq>=1 && body.seq<=this.state.seq && body.seq>=(this.state.pi_last_ack_seq || 0),409,'Invalid or regressing ACK');
    if(body.seq!==this.state.pi_last_ack_seq) { this.state.pi_last_ack_seq=body.seq; this.state.pi_last_ack_timestamp=new Date(now).toISOString(); writeJson(this.file,this.state); }
    return {acknowledged:true,...this.info(now)};
  }
}
