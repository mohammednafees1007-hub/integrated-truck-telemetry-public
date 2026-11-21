import React,{useEffect,useRef,useState} from 'react';
type Clip={recorded_not_live:boolean;duration_seconds:number;segments:{action:string;frames:number;face_frames:number}[]};
export function RecordedFatigueDemo(){
 const [clip,setClip]=useState<Clip|null>(null),[open,setOpen]=useState(()=>new URLSearchParams(location.search).get('recording')==='fatigue'),[error,setError]=useState('');
 const video=useRef<HTMLVideoElement>(null);
 const base=import.meta.env.BASE_URL+'recordings/';
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  fetch(base+'fatigue-camera-demo.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(v=>{if(active&&v.recorded_not_live&&Array.isArray(v.segments))setClip(v);}).catch(()=>{});
  return()=>{active=false;controller.abort();};
 },[base]);
 if(!clip)return null;
 return <section className="mb-5 rounded-2xl border border-emerald-500/40 bg-slate-900 p-4" aria-label="Recorded Pi fatigue demonstration">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs tracking-widest font-bold text-emerald-300">RECORDED PI CAMERA · NOT LIVE</p><h2 className="text-lg font-bold text-white mt-1">Your fatigue-model demonstration</h2></div><button className="px-3 py-2 rounded-lg border border-slate-600 text-xs" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'Hide recorded clip':'Show recorded clip'}</button></div>
  <p className="text-xs text-slate-300 mt-3">{clip.duration_seconds.toFixed(0)} seconds · {clip.segments.length} cued actions. Real Pi-camera footage and observed model states; the surrounding dashboard examples remain synthetic.</p>
  {open&&<><video ref={video} className="w-full max-h-[65vh] rounded-xl bg-black mt-4" controls loop playsInline preload="metadata" src={base+'fatigue-camera-demo.webm'} aria-label="Recorded real Pi camera fatigue clip"/>
   <div className="flex flex-wrap items-center gap-3 mt-3"><button className="px-4 py-2 bg-emerald-600 rounded-lg text-sm text-white" onClick={()=>{setError('');video.current?.play().catch(()=>setError('Could not start the clip. Try the video play control.'));}}>Play face recording</button><button className="px-3 py-2 bg-slate-800 rounded-lg text-sm" onClick={()=>{if(video.current){video.current.currentTime=0;video.current.play().catch(()=>setError('Press Play to restart the clip.'));}}}>Replay face recording</button><a className="text-xs underline text-cyan-300" download href={base+'fatigue-camera-demo.webm'}>Download recorded clip</a></div>
   <p className="text-xs text-amber-200 mt-3">Loop is enabled. The overlay labels the requested action and the Pi state observed near capture time. It does not prove every action was classified correctly, and this is not fresh live inference.</p>
   <ol className="grid sm:grid-cols-2 gap-2 mt-3 text-xs text-slate-400">{clip.segments.map((s,i)=><li key={i}>{i+1}. {s.action} · {s.face_frames}/{s.frames} frames with a detected face</li>)}</ol>{error&&<p role="alert" className="text-rose-300 text-sm mt-2">{error}</p>}
  </>}
 </section>;
}
