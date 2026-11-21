import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {ActiveNavTab} from '../types';
import {getDemoScenario} from '../services/presentationDemo';
import {BUILT_IN_SESSION,beginRecording,detectSavedRecording,exitPlayback,finishRecording,getPlayerState,loadSavedRecording,loadSession,pauseSession,playSession,seekSession,setPlayerLoop,subscribePlayer,validateSession,DemoSession,DemoEvent} from '../services/demoRecording';

const clock=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
export function DemoSessionPlayer({tab,onFrame,onReset,onPlaybackChange}:{tab:ActiveNavTab;onFrame:(event:DemoEvent,session:DemoSession,position:number)=>void;onReset:()=>void;onPlaybackChange:(active:boolean)=>void}) {
 const state=useSyncExternalStore(subscribePlayer,getPlayerState),[error,setError]=useState('');
 const walkthroughVideo=useRef<HTMLVideoElement>(null);
 const callbacks=useRef({onFrame,onReset,onPlaybackChange});callbacks.current={onFrame,onReset,onPlaybackChange};
 const active=state.status==='playing'||state.status==='paused'||state.status==='ended',recording=state.status==='recording';
 useEffect(()=>{detectSavedRecording();},[]);
 useEffect(()=>{callbacks.current.onPlaybackChange(active);},[active]);
 useEffect(()=>{if(state.runId>0)callbacks.current.onReset();},[state.runId]);
 useEffect(()=>{
  if(active)callbacks.current.onFrame(state.session.events[state.eventIndex],state.session,state.positionMs);
 },[state.applyId,state.session,active]);
 const safely=(fn:()=>void)=>{try{fn();setError('');}catch(e){setError(e instanceof Error?e.message:'Session could not be loaded');}};
 const download=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(state.session,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='truck-synthetic-demo-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const cls='rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-white disabled:opacity-40';
 return <section className="mb-5 rounded-2xl border border-cyan-500/30 bg-slate-900 p-4" aria-label="Recorded demo player">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold tracking-widest text-cyan-300">REPEATABLE SYNTHETIC DEMO</p><h2 className="text-base font-bold text-white mt-1">{state.session.title}</h2></div><span role="status" className="text-xs text-amber-300">{recording?'RECORDING YOUR SEQUENCE':state.status.toUpperCase()} · {clock(state.positionMs)} / {clock(state.session.durationMs)}</span></div>
  <p className="text-sm text-slate-300 mt-3" aria-live="polite">{recording?'Choose dashboard tabs and scenarios, then Save recording.':active?state.session.events[state.eventIndex].caption:'Play the prepared 2 minute 10 second walkthrough, or record your own tab and scenario sequence.'}</p>
  <div className="flex flex-wrap gap-2 mt-3">
   <button className={cls} disabled={recording||state.status==='playing'} onClick={()=>playSession()}>Play demo</button>
   <button className={cls} disabled={state.status!=='playing'} onClick={pauseSession}>Pause</button>
   <button className={cls} disabled={recording} onClick={()=>playSession(true)}>Replay from start</button>
   <button className={cls} disabled={!active} onClick={exitPlayback}>Exit playback</button>
   <label className="flex items-center gap-2 text-xs px-2"><input type="checkbox" checked={state.loop} onChange={e=>setPlayerLoop(e.target.checked)}/>Loop replay</label>
  </div>
  <label className="block text-xs text-slate-400 mt-3">Demo timeline
   <input aria-label="Demo timeline" type="range" className="block w-full mt-2 accent-cyan-400" min="0" max={state.session.durationMs} step="100" value={Math.min(state.positionMs,state.session.durationMs)} disabled={recording} onChange={e=>seekSession(Number(e.target.value))}/>
  </label>
  <details className="mt-3" open={recording?true:undefined}><summary className="cursor-pointer text-xs text-cyan-300">Record save or import a session</summary><div className="flex flex-wrap gap-2 mt-3">
   <button className={cls} disabled={recording} onClick={()=>beginRecording(tab,getDemoScenario())}>Record my demo</button>
   <button className={cls} disabled={!recording} onClick={finishRecording}>Save recording</button>
   <button className={cls} disabled={recording||!state.hasSaved} onClick={()=>safely(loadSavedRecording)}>Load my recording</button>
   <button className={cls} disabled={recording} onClick={()=>loadSession(BUILT_IN_SESSION)}>Prepared walkthrough</button>
   <button className={cls} disabled={recording} onClick={download}>Download session</button>
   <label className={cls+` ${recording?'opacity-40':''}`}>Import session<input type="file" accept="application/json,.json" aria-label="Import demo session" className="sr-only" disabled={recording} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>512000)throw Error('Session file is too large');loadSession(validateSession(JSON.parse(await file.text())));setError('');}catch(err){setError(err instanceof Error?err.message:'Could not read session');}e.target.value='';}}/></label>
  </div>
  <p className="text-xs text-slate-400 mt-3">Records the tab/scenario sequence and synthetic motion clock. This is an interactive session recording, not a camera or screen-video recording. Form edits are not captured. Saved recordings stay in this browser; download a backup to keep them.</p>
  </details>
  <details className="mt-3"><summary className="cursor-pointer text-xs text-cyan-300">Watch the saved walkthrough video</summary><p className="text-xs text-slate-400 my-3">A silent recording of the synthetic walkthrough with on-screen explanations. The video can loop independently of the interactive demo.</p><video ref={walkthroughVideo} className="w-full rounded-lg bg-black" controls loop preload="none" src={`${import.meta.env.BASE_URL}recordings/project-walkthrough.webm`} aria-label="Recorded synthetic project walkthrough"/><div className="flex items-center gap-3 mt-2"><button className={cls} onClick={()=>walkthroughVideo.current?.play().catch(()=>setError('Could not start the video. Try its play control.'))}>Play saved walkthrough</button><a className="text-xs text-cyan-300 underline" download href={`${import.meta.env.BASE_URL}recordings/project-walkthrough.webm`}>Download walkthrough video</a></div></details>
  {state.message&&<p className="text-xs text-cyan-200 mt-2">{state.message}</p>}{error&&<p role="alert" className="text-sm text-rose-300 mt-2">{error}</p>}
 </section>;
}
