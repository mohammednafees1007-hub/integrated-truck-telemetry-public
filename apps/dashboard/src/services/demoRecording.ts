import type {ActiveNavTab} from '../types';
import {setDemoClock,setDemoScenario,DemoScenario} from './presentationDemo';

export type DemoEvent={atMs:number;tab:ActiveNavTab;scenario:DemoScenario;caption:string};
export type DemoSession={schema:1;synthetic:true;title:string;durationMs:number;events:DemoEvent[]};
export const RECORDING_KEY='truck-synthetic-recording-v1';
const tabs=['dashboard','fleet','drivers','geofencing','monitoring','dynamics','fuel','notifications','advanced'];
const scenarios=['normal','drowsy','critical','no_face','offline'];
export function validateSession(value:any):DemoSession {
 if(!value||value.schema!==1||value.synthetic!==true||typeof value.title!=='string'||!value.title.trim()||value.title.length>120||!Number.isFinite(value.durationMs)||value.durationMs<1000||value.durationMs>1800000||!Array.isArray(value.events)||value.events.length<1||value.events.length>2000)throw Error('Invalid synthetic session file');
 let last=-1;
 const events=value.events.map((e:any)=>{
  if(!e||!Number.isFinite(e.atMs)||e.atMs<last||e.atMs<0||e.atMs>value.durationMs||!tabs.includes(e.tab)||!scenarios.includes(e.scenario)||typeof e.caption!=='string'||e.caption.length>300)throw Error('Invalid demo event');
  last=e.atMs;return {atMs:e.atMs,tab:e.tab,scenario:e.scenario,caption:e.caption};
 });
 if(events[0].atMs!==0)throw Error('The first event must begin at zero');
 return {schema:1,synthetic:true,title:value.title,durationMs:value.durationMs,events};
}
export const BUILT_IN_SESSION:DemoSession={schema:1,synthetic:true,title:'Complete project walkthrough',durationMs:130000,events:[
 {atMs:0,tab:'dashboard',scenario:'normal',caption:'Start with the overall system: sensors, Pi, receiver and dashboard. All values in this recording are synthetic.'},
 {atMs:10000,tab:'fleet',scenario:'normal',caption:'Fleet Management combines vehicle rows and sample map positions. The actual prototype tracks one vehicle.'},
 {atMs:20000,tab:'drivers',scenario:'normal',caption:'RFID identifies a presented card. The saved registry associates that identifier with a driver.'},
 {atMs:30000,tab:'geofencing',scenario:'normal',caption:'Assigned areas and route corridors use fresh GPS. A transition may create a notification.'},
 {atMs:40000,tab:'dynamics',scenario:'normal',caption:'The 3D truck follows an orientation quaternion. Replay reproduces the same synthetic motion.'},
 {atMs:50000,tab:'fuel',scenario:'normal',caption:'Ultrasonic echo gives distance. Sample fuel charts illustrate the intended workflow; real tank volume needs calibration.'},
 {atMs:60000,tab:'monitoring',scenario:'normal',caption:'The illustrated driver is alert. The real Pi pipeline uses face detection, landmarks and temporal cue rules.'},
 {atMs:70000,tab:'monitoring',scenario:'drowsy',caption:'The synthetic driver closes their eyes and yawns. The example score rises to DROWSY.'},
 {atMs:80000,tab:'monitoring',scenario:'critical',caption:'Sustained example cues raise CRITICAL severity and create a labelled demonstration alert.'},
 {atMs:90000,tab:'monitoring',scenario:'no_face',caption:'No face means no valid fatigue result. It must not be classified as safe driving.'},
 {atMs:100000,tab:'notifications',scenario:'normal',caption:'Review the example alert history. No email or external notification is sent.'},
 {atMs:110000,tab:'advanced',scenario:'offline',caption:'A lost link makes measurements unavailable. Diagnostics show source age and validation separately.'},
 {atMs:120000,tab:'dashboard',scenario:'normal',caption:'The example recovers. Replay, loop or record your own tab and scenario sequence.'}
]};
export function eventAt(session:DemoSession,atMs:number):number {
 let i=0;while(i+1<session.events.length&&session.events[i+1].atMs<=atMs)i++;return i;
}
export type PlayerState={status:'idle'|'playing'|'paused'|'recording'|'ended';session:DemoSession;positionMs:number;eventIndex:number;runId:number;applyId:number;loop:boolean;hasSaved:boolean;message:string};
let state:PlayerState={status:'idle',session:BUILT_IN_SESSION,positionMs:0,eventIndex:0,runId:0,applyId:0,loop:false,hasSaved:false,message:''};
const subscribers=new Set<()=>void>();
let timer:ReturnType<typeof setInterval>|null=null,lastTick=0,recordStart=0,events:DemoEvent[]=[];
const emit=()=>subscribers.forEach(fn=>fn());
const update=(value:Partial<PlayerState>)=>{state={...state,...value};emit();};
const stopTimer=()=>{if(timer)clearInterval(timer);timer=null;};
export const getPlayerState=()=>state;
export const subscribePlayer=(fn:()=>void)=>{subscribers.add(fn);return()=>{subscribers.delete(fn);};};
function applyTime(positionMs:number) {
 const index=eventAt(state.session,positionMs),event=state.session.events[index];
 setDemoClock(positionMs);setDemoScenario(event.scenario);
 update({positionMs,eventIndex:index,applyId:state.applyId+(index!==state.eventIndex?1:0)});
}
function startTimer() {
 stopTimer();lastTick=performance.now();
 timer=setInterval(()=>{
  const now=performance.now(),delta=Math.max(0,now-lastTick);lastTick=now;
  if(state.status==='recording'){
   const elapsed=Math.min(1800000,now-recordStart);setDemoClock(elapsed);update({positionMs:elapsed});
   if(elapsed>=1800000)finishRecording();
   return;
  }
  if(state.status!=='playing')return;
  const next=state.positionMs+delta;
  if(next>=state.session.durationMs){
   if(state.loop){update({runId:state.runId+1,applyId:state.applyId+1});applyTime(0);}
   else {applyTime(state.session.durationMs);stopTimer();update({status:'ended'});}
  }else applyTime(next);
 },100);
}
export function playSession(restart=false) {
 if(state.status==='recording')return;
 const reset=restart||state.status==='idle'||state.status==='ended';
 update({status:'playing',positionMs:reset?0:state.positionMs,runId:state.runId+(reset?1:0),applyId:state.applyId+1,message:''});
 applyTime(state.positionMs);startTimer();
}
export function pauseSession() {if(state.status!=='playing')return;stopTimer();update({status:'paused'});}
export function seekSession(value:number) {
 if(state.status==='recording'||!Number.isFinite(value))return;
 const position=Math.max(0,Math.min(state.session.durationMs,value));
 if(state.status==='idle'||state.status==='ended')update({status:'paused'});
 update({applyId:state.applyId+1});applyTime(position);
}
export function setPlayerLoop(loop:boolean){update({loop});}
export function loadSession(session:DemoSession) {
 const checked=validateSession(session);stopTimer();setDemoClock(null);
 update({session:checked,status:'idle',positionMs:0,eventIndex:0,message:''});
}
export function exitPlayback(){stopTimer();setDemoClock(null);update({status:'idle',positionMs:0,eventIndex:0});}
export function beginRecording(tab:ActiveNavTab,scenario:DemoScenario) {
 stopTimer();recordStart=performance.now();events=[{atMs:0,tab,scenario,caption:'Recorded synthetic demonstration'}];
 setDemoClock(0);update({status:'recording',positionMs:0,message:'Recording tab changes and scenario choices only. No real camera, GPS or form data is captured.'});startTimer();
}
export function recordDemoEvent(tab:ActiveNavTab,scenario:DemoScenario) {
 if(state.status!=='recording')return;
 const last=events.at(-1);if(last?.tab===tab&&last.scenario===scenario)return;
 if(events.length>=2000){finishRecording();return;}
 events.push({atMs:Math.min(1800000,Math.max(0,performance.now()-recordStart)),tab,scenario,caption:`Recorded ${tab} section · ${scenario.replace('_',' ')}`});
}
export function finishRecording() {
 if(state.status!=='recording')return;
 stopTimer();const session=validateSession({schema:1,synthetic:true,title:'My recorded synthetic demo',durationMs:Math.max(1000,Math.min(1800000,performance.now()-recordStart)),events});
 setDemoClock(null);let message='Recording saved on this browser. Use Replay or download the session file.';
 try {localStorage.setItem(RECORDING_KEY,JSON.stringify(session));}catch {message='Browser storage unavailable. Download the session file now to keep it.';}
 update({status:'idle',session,positionMs:0,eventIndex:0,hasSaved:true,message});
}
export function loadSavedRecording(){const value=localStorage.getItem(RECORDING_KEY);if(!value)throw Error('No saved recording in this browser yet');loadSession(validateSession(JSON.parse(value)));}
export function detectSavedRecording(){try{const v=localStorage.getItem(RECORDING_KEY);if(v){validateSession(JSON.parse(v));update({hasSaved:true});}}catch{}}
