import {client,save,load} from './lib.mjs'; import {between,pick,R,pad} from './data.mjs'; import fs from 'node:fs'; import {execSync} from 'node:child_process'; import crypto from 'node:crypto';
const N=Number(process.env.N||1); // scale divisor for tests
const APW=fs.readFileSync('/tmp/gen/admin.pw','utf8').trim();
let admin=await client('admin',APW); let curBranch=null;
const cr=JSON.parse(fs.readFileSync('/tmp/gen/credentials.json','utf8')); const pw=u=>cr.find(c=>c.username===u).password;
const whm=await client('wh.mgr',pw('wh.mgr')); const sk=await client('store.cai',pw('store.cai'));
const S=load('S');
const adminId=(await admin('GET','/admin/users')).items?.find?.(u=>u.username==='admin')?.id;
const allB=Object.values(S.branches);
async function at(code){ if(curBranch===code)return; await (await client('admin',APW)) && 0; const root=await client('admin',APW); await root('PATCH','/admin/users/'+adminId,{branchIds:[S.branches[code]]}); admin=await client('admin',APW); curBranch=code; }
async function atAll(){const root=await client('admin',APW); await root('PATCH','/admin/users/'+adminId,{branchIds:allB}); admin=await client('admin',APW); curBranch=null;}
async function restoreAdmin(){const root=await client('admin',APW); await root('PATCH','/admin/users/'+adminId,{branchIds:allB});}
 const Q=S.qty; const key=(w,i)=>w+':'+i;
function refresh(wids){ for(const w of wids){ for(const k of Object.keys(Q)) if(k.startsWith(w+':')) delete Q[k];
  const out=execSync(`PGPASSWORD=kayan psql -h 127.0.0.1 -p 55432 -U kayan -d kayan_solar_build -Atc "select \\"itemId\\",quantity from warehouse_stock_balances where \\"warehouseId\\"='${w}'"`).toString().trim();
  for(const line of out.split('\n').filter(Boolean)){const [i,q]=line.split('|');Q[w+':'+i]=Number(q);} } }
const WT={ 'HQ-MAIN':['PNL','MNT','PMP','HTL'],'HQ-INV':['INV','BAT','PNL'],'HQ-ACC':['CAB','PRT','CTL','TLS'],'ALX-MAIN':['PNL','MNT','PMP','HTL'],'ALX-BAT':['INV','BAT'],'ALX-ACC':['CAB','PRT','CTL','TLS'],
 'MNS-MAIN':['PNL','INV','BAT','MNT','PMP','HTL'],'MNS-ACC':['CAB','PRT','CTL','TLS'],'AST-MAIN':['PNL','INV','BAT','MNT','PMP','HTL'],'AST-ACC':['CAB','PRT','CTL','TLS'],'HRG-MAIN':['PNL','INV','BAT','MNT','PMP','HTL'],'HRG-ACC':['CAB','PRT','CTL','TLS']};
const wcodes=Object.keys(WT); const widToCode=Object.fromEntries(Object.entries(S.wh).map(([c,i])=>[i,c]));
const addDays=(iso,d)=>{const t=new Date(iso+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+d);return t.toISOString().slice(0,10)};
const LAST='2026-11-22';
const clamp=d=>d>LAST?LAST:d;
// cash accounts
S.cash={};
for(const [c,ar,en,acc,kind] of [['BOX1','الخزينة الرئيسية','Main cash box','1101','CASH'],['CIB','البنك التجاري الدولي','CIB current account','1102','BANK'],['NBE','البنك الأهلي','NBE current account','1107','BANK']]){
  const r=await admin('POST','/cash/accounts',{code:c,nameAr:ar,nameEn:en,accountId:S.acc[acc],kind}); S.cash[c]=r.id;}
await admin('POST','/admin/approvals/policies',{operation:'STOCK_TRANSFER',nameEn:'All stock transfers',nameAr:'كل التحويلات المخزنية',priority:100,alwaysRequire:true,levels:[{level:1,permission:'inventory.transfer.review',roleCode:'WAREHOUSE_MANAGER',nameEn:'Warehouse manager review',nameAr:'مراجعة مدير المخازن'},{level:2,permission:'inventory.transfer.approve',roleCode:'ADMIN',nameEn:'Administrator approval',nameAr:'اعتماد مدير النظام'}]});
// build timeline
const ev=[];
const span=(a,b,i,n)=>{const t=new Date(a+'T00:00:00Z').getTime(),u=new Date(b+'T00:00:00Z').getTime();return new Date(t+(u-t)*(i/n)+between(-2,2)*86400000*0.5).toISOString().slice(0,10)};
const NP=Math.round(200/N),NS=Math.round(500/N),NT=Math.round(100/N);
for(let i=0;i<NP;i++)ev.push({t:'P',date:clamp(span('2026-01-05','2026-11-12',i,NP)),i});
for(let i=0;i<NS;i++)ev.push({t:'S',date:clamp(span('2026-01-12','2026-11-22',i,NS)),i});
for(let i=0;i<NT;i++)ev.push({t:'T',date:clamp(span('2026-02-02','2026-11-10',i,NT)),i});
ev.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:(a.t<b.t?-1:1));
const stats={P:0,Pdraft:0,S:0,Sdraft:0,Srev:0,T:{},rc:0,pv:0,skipped:0};
const qtyFor=cat=>cat==='PNL'?between(30,120):cat==='INV'?between(4,20):cat==='BAT'?between(3,15):cat==='MNT'?between(15,60):cat==='CAB'||cat==='PRT'?between(15,70):cat==='TLS'?between(20,80):between(5,30);
const byCat=c=>S.items.filter(x=>c.includes(x.cat));
const open={S:[],P:[]};
const M=n=>Number(n).toFixed(2);
let pcount=0,scount=0;
for(const e of ev){
 try{
 if(e.t==='P'){
  const wc=wcodes[e.i%wcodes.length]; const wid=S.wh[wc]; await at(wc.split('-')[0]); const sup=pick(S.suppliers);
  const pool=byCat(WT[wc]); const n=between(2,6); const chosen=[...new Set(Array.from({length:n},()=>pick(pool)))];
  const draft=e.i%25===24;
  const body={invoiceDate:e.date,dueDate:addDays(e.date,30),supplierId:sup.id,warehouseId:wid,supplierReference:'SUP-'+between(10000,99999),notes:draft?'بانتظار إذن الاستلام':undefined,lines:chosen.map(it=>({itemId:it.id,quantity:String(qtyFor(it.cat)),unitPrice:M(it.cost*(0.96+R()*0.08)),taxRate:String(it.tax)}))};
  const inv=await admin('POST','/purchases/invoices',body);
  if(draft){stats.Pdraft++;continue}
  const p=await admin('POST',`/purchases/invoices/${inv.id}/post`,{});
  for(const l of body.lines)Q[key(wid,l.itemId)]=(Q[key(wid,l.itemId)]||0)+Number(l.quantity);
  stats.P++; const tot=Number(inv.totalAmount||p.totalAmount); open.P.push({id:inv.id,supplierId:sup.id,total:tot,date:e.date});
  if(e.i%5!==0){ const frac=e.i%7===0?0.5:1; await admin('POST','/cash/vouchers',{kind:'PAYMENT',cashAccountId:S.cash[pick(['CIB','CIB','NBE','BOX1'])],voucherDate:clamp(addDays(e.date,between(7,40))),amount:M(Math.floor(tot*frac*100)/100),supplierId:sup.id,description:'سداد فاتورة مشتريات',allocations:[{purchaseInvoiceId:inv.id,amount:M(Math.floor(tot*frac*100)/100)}]}).then(v=>admin('POST',`/cash/vouchers/${v.id}/post`,{})); stats.pv++; }
 }
 if(e.t==='S'){
  let wc,wid,avail=[];
  for(let k=0;k<20&&avail.length<3;k++){wc=wcodes[between(0,wcodes.length-1)];wid=S.wh[wc];refresh([wid]);avail=S.items.filter(it=>(Q[key(wid,it.id)]||0)>=2&&WT[wc].includes(it.cat));}
  if(avail.length<2){stats.skipped++;continue}
  await at(wc.split('-')[0]);
  const n=between(1,5); const chosen=[...new Set(Array.from({length:n},()=>pick(avail)))];
  const cust=pick(S.customers); const draft=e.i%25===12;
  const lines=chosen.map(it=>{const have=Q[key(wid,it.id)];const q=Math.max(1,Math.min(have-1,it.cat==='PNL'?between(6,30):it.cat==='INV'||it.cat==='BAT'?between(1,3):between(1,12)));return{itemId:it.id,quantity:String(q),unitPrice:M(it.price*(0.95+R()*0.1)),taxRate:String(it.tax)}});
  const body={invoiceDate:e.date,dueDate:addDays(e.date,pick([0,15,30])),customerId:cust.id,warehouseId:wid,notes:draft?'عرض بانتظار موافقة العميل':'فاتورة بيع وتركيب',lines};
  const inv=await admin('POST','/sales/invoices',body);
  if(draft){stats.Sdraft++;continue}
  const p=await admin('POST',`/sales/invoices/${inv.id}/post`,{});
  for(const l of lines)Q[key(wid,l.itemId)]-=Number(l.quantity);
  stats.S++;
  const total=Number(inv.totalAmount||p.totalAmount);
  if(e.i%47===5){ await admin('POST',`/sales/invoices/${inv.id}/reverse`,{reason:'مرتجع كامل بطلب العميل'}); for(const l of lines)Q[key(wid,l.itemId)]+=Number(l.quantity); stats.Srev++; continue}
  open.S.push({id:inv.id,customerId:cust.id,total,date:e.date});
  if(e.i%6!==0){ const frac=e.i%5===0?0.5:1; await admin('POST','/cash/vouchers',{kind:'RECEIPT',cashAccountId:S.cash[pick(['CIB','CIB','NBE','BOX1'])],voucherDate:clamp(addDays(e.date,between(0,35))),amount:M(Math.floor(total*frac*100)/100),customerId:cust.id,description:'تحصيل فاتورة مبيعات',allocations:[{salesInvoiceId:inv.id,amount:M(Math.floor(total*frac*100)/100)}]}).then(v=>admin('POST',`/cash/vouchers/${v.id}/post`,{})); stats.rc++; }
 }
 if(e.t==='T'){
  let sc,dc,sid,did,pool=[];
  for(let k=0;k<30&&pool.length<1;k++){sc=pick(wcodes);dc=pick(wcodes);if(sc===dc)continue;sid=S.wh[sc];did=S.wh[dc];refresh([sid]);pool=S.items.filter(it=>(Q[key(sid,it.id)]||0)>=6&&WT[sc].includes(it.cat)&&WT[dc].includes(it.cat));}
  if(pool.length<1){stats.skipped++;continue}
  const chosen=[...new Set(Array.from({length:between(1,5)},()=>pick(pool)))];
  const lines=chosen.map(it=>({itemId:it.id,quantity:String(Math.max(1,Math.floor(Q[key(sid,it.id)]/between(3,5))))}));
  // outcome mix
  const r=e.i%20; const outcome=r<11?'closed':r<14?'transit':r<16?'approved':r<18?'submitted':r===18?'draft':'rejected';
  const t=await sk('POST','/inventory/stock-transfers',{sourceWarehouseId:sid,destinationWarehouseId:did,transferDate:e.date,reason:pick(['تغذية فرع بالمخزون','إعادة توزيع أرصدة راكدة','تجهيز مشروع تركيب','موازنة المخزون بين المخازن']),idempotencyKey:crypto.randomUUID(),lines});
  const step=async(c,n,b={})=>c('POST',`/inventory/stock-transfers/${t.id}/${n}`,b,{'idempotency-key':crypto.randomUUID()});
  if(outcome!=='draft'){await step(sk,'submit'); }
  if(outcome==='submitted'){stats.T[outcome]=(stats.T[outcome]||0)+1;continue}
  if(outcome==='rejected'){await step(whm,'reject',{reason:'الكمية المطلوبة محجوزة لمشروع آخر'});stats.T[outcome]=(stats.T[outcome]||0)+1;continue}
  if(outcome==='draft'){stats.T[outcome]=(stats.T[outcome]||0)+1;continue}
  await step(whm,'approve',{}); await atAll(); await step(admin,'approve',{});
  if(outcome==='approved'){stats.T[outcome]=(stats.T[outcome]||0)+1;continue}
  await step(sk,'dispatch',{}); for(const l of lines)Q[key(sid,l.itemId)]-=Number(l.quantity);
  if(outcome==='transit'){stats.T[outcome]=(stats.T[outcome]||0)+1;continue}
  const full=await whm('GET','/inventory/stock-transfers/'+t.id);
  await step(sk,'receive',{lines:full.lines.map(l=>({lineId:l.id,quantity:String(Number(l.requestedQuantity))}))});
  for(const l of lines)Q[key(did,l.itemId)]=(Q[key(did,l.itemId)]||0)+Number(l.quantity);
  await step(whm,'close',{}); stats.T[outcome]=(stats.T[outcome]||0)+1;
 }
 }catch(err){console.log('ERR',e.t,e.i,e.date,err.message.slice(0,350)); stats.err=(stats.err||0)+1; if(stats.err>5){await restoreAdmin();console.log(stats);save('S',S);process.exit(1)}}
}
await restoreAdmin(); console.log(JSON.stringify(stats)); S.open=open; save('S',S);
