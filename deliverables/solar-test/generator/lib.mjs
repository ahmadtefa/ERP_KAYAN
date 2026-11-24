import fs from 'node:fs';
export const BASE='http://127.0.0.1:3999/api/v1';
let token='';
export async function login(u,p){const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!j.accessToken)throw new Error('login '+JSON.stringify(j));token=j.accessToken;return j;}
export async function api(method,path,body,headers={}){
  const r=await fetch(BASE+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t}
  if(!r.ok){const e=new Error(`${method} ${path} -> ${r.status} ${typeof j==='string'?j:JSON.stringify(j)}`);e.status=r.status;e.body=j;throw e;}
  return j;
}
export function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
export const save=(n,o)=>fs.writeFileSync('/tmp/gen/'+n+'.json',JSON.stringify(o,null,1));
export const load=(n)=>JSON.parse(fs.readFileSync('/tmp/gen/'+n+'.json','utf8'));
export async function client(u,p){const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!j.accessToken)throw new Error('login '+u+JSON.stringify(j));const tk=j.accessToken;
 return async(method,path,body,headers={})=>{const rr=await fetch(BASE+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+tk,...headers},body:body===undefined?undefined:JSON.stringify(body)});const t=await rr.text();let jj;try{jj=JSON.parse(t)}catch{jj=t}if(!rr.ok){const e=new Error(`${u} ${method} ${path} -> ${rr.status} ${typeof jj==='string'?jj:JSON.stringify(jj)}`);e.status=rr.status;throw e}return jj}}
