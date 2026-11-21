export type Quaternion={w:number,x:number,y:number,z:number};
export type Vector3=[number,number,number];
export const IDENTITY:Quaternion={w:1,x:0,y:0,z:0};
export function normalizedQuaternion(q:any):Quaternion|null {
 if(!q||!['w','x','y','z'].every(k=>typeof q[k]==='number'&&Number.isFinite(q[k])))return null;
 const n=Math.hypot(q.w,q.x,q.y,q.z);if(n<.8||n>1.2)return null;
 return {w:q.w/n,x:q.x/n,y:q.y/n,z:q.z/n};
}
export const inverse=(q:Quaternion):Quaternion=>({w:q.w,x:-q.x,y:-q.y,z:-q.z});
export function multiply(a:Quaternion,b:Quaternion):Quaternion {return {w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w};}
export function rotate(v:Vector3,q:Quaternion):Vector3 {const p=multiply(multiply(q,{w:0,x:v[0],y:v[1],z:v[2]}),inverse(q));return[p.x,p.y,p.z];}
// Truck coordinates: +X nose, +Y left, +Z roof. Display is right-handed X nose, Y roof, Z right.
export const toScene=(v:Vector3):Vector3=>[v[0],v[2],-v[1]];
export const relativeOrientation=(q:Quaternion,reference:Quaternion|null)=>reference?multiply(inverse(reference),q):q;
