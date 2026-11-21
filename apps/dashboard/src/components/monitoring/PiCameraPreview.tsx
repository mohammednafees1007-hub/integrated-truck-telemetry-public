import React, {useEffect,useState} from 'react';
import {apiUrl} from '../../services/api';
export function PiCameraPreview() {
  const [enabled,setEnabled]=useState(false),[url,setUrl]=useState<string|null>(null),[error,setError]=useState('Start the camera locally on the Raspberry Pi, then enable preview here.');
  useEffect(()=>{
    if(!enabled) {setUrl(null);return;}
    let stopped=false, timer:ReturnType<typeof setTimeout>, previous:string|null=null;
    const poll=async()=>{
      try {
        const r=await fetch(apiUrl('/api/camera/latest'),{signal:AbortSignal.timeout(3000)});
        if(!r.ok) throw Error();
        const blob=await r.blob(); if(stopped) return;
        const next=URL.createObjectURL(blob);setUrl(next);if(previous) URL.revokeObjectURL(previous);previous=next;setError('');
      } catch {if(!stopped) {setUrl(null);setError('Pi camera unavailable / no face / stale. Sensor acquisition continues independently.');}}
      if(!stopped) timer=setTimeout(poll,600);
    }; poll();
    return ()=>{stopped=true;clearTimeout(timer);if(previous)URL.revokeObjectURL(previous);};
  },[enabled]);
  return <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl group">
    {url && <img src={url} alt="Latest Raspberry Pi camera frame" className="absolute inset-0 w-full h-full object-contain"/>}
    {!url && <div className="absolute inset-0 flex items-center justify-center text-slate-300 p-8 text-center text-sm">{error || 'Preview stopped locally'}</div>}
    <div className="absolute bottom-0 inset-x-0 bg-slate-950/90 p-3 text-xs text-slate-300 flex flex-wrap gap-3 items-center"><span>RASPBERRY PI · ONNX results · latest JPEG</span><button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={()=>setEnabled(v=>!v)}>{enabled?'Stop preview':'Enable preview'}</button><span>Pi command: systemctl --user start prototype-camera.service · stop with systemctl --user stop prototype-camera.service</span></div>
  </div>;
}
