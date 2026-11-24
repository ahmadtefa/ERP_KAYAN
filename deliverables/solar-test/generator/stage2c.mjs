import {client,save,load} from './lib.mjs'; import {between,pick,R} from './data.mjs'; import fs from 'node:fs'; import {execSync} from 'node:child_process';
const APW=fs.readFileSync('/tmp/gen/admin.pw','utf8').trim(); const admin=await client('admin',APW); const S=load('S');
const M=n=>Number(n).toFixed(2); let je=0;
const A=c=>S.acc[c], C=c=>S.cc[c];
async function entry(date,desc,lines){const e=await admin('POST','/accounting/journal-entries',{entryDate:date,description:desc,lines:lines.map(l=>({accountId:A(l[0]),debit:l[1]?M(l[1]):undefined,credit:l[2]?M(l[2]):undefined,costCenterId:l[3]?C(l[3]):undefined,description:l[4]}))}); await admin('POST',`/accounting/journal-entries/${e.id}/post`,{}); je++;}
await entry('2026-01-02','رأس المال المدفوع من الشركاء',[['1102',2500000],['3101',null,2500000]]);
await entry('2026-01-10','شراء سيارات خدمة لفرق التركيب',[['1205',900000],['1102',null,900000]]);
await entry('2026-01-12','شراء عدد وأدوات التركيب',[['1204',140000],['1101',null,140000]]);
for(let m=1;m<=11;m++){const d=(day)=>`2026-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const sal=between(300,360)*1000; await entry(d(28),`رواتب شهر ${m}`,[['5102',sal*0.35,0,'CC02'],['5102',sal*0.25,0,'CC01'],['5102',sal*0.2,0,'CC03'],['5102',sal*0.2,0,'CC06'],['2104',0,sal]]);
  await entry(d(29),`صرف رواتب شهر ${m}`,[['2104',sal],['1102',0,sal]]);
  const rent=between(95,110)*1000; await entry(d(5),`إيجار المقار والمخازن شهر ${m}`,[['5103',rent*0.5,0,'CC05'],['5103',rent*0.5,0,'CC06'],['1102',0,rent]]);
  const ut=between(14,30)*1000; await entry(d(10),`كهرباء ومياه واتصالات شهر ${m}`,[['5104',ut,0,'CC06'],['1101',0,ut]]);
  const fuel=between(25,60)*1000; await entry(d(12),`وقود ونقل فرق التركيب شهر ${m}`,[['5109',fuel,0,'CC02'],['1101',0,fuel]]);
  const lab=between(80,160)*1000; await entry(d(20),`أجور مقاولي التركيب شهر ${m}`,[['5110',lab,0,'CC02'],['1102',0,lab]]);
  if(m%2===1){const mk=between(20,70)*1000; await entry(d(15),`حملة تسويق ${m}`,[['5108',mk,0,'CC08'],['1102',0,mk]]);}
  if(m%3===0){const w=between(15,45)*1000; await entry(d(18),`مصروفات ضمان وصيانة`,[['5111',w,0,'CC03'],['1101',0,w]]);}
  await entry(d(28),`إهلاك شهري`,[['5105',32000,0,'CC06'],['1203',0,32000]]);
  const bc=between(900,2500); await entry(d(27),`مصروفات بنكية`,[['5112',bc,0,'CC07'],['1102',0,bc]]);
}
console.log('journal entries manual',je);
// thresholds
let th=0; const wh=Object.entries(S.wh);
for(const [wc,wid] of wh){ const rows=execSync(`PGPASSWORD=kayan psql -h 127.0.0.1 -p 55432 -U kayan -d kayan_solar_build -Atc "select \\"itemId\\",quantity from warehouse_stock_balances where \\"warehouseId\\"='${wid}' order by quantity limit 40"`).toString().trim().split('\n').filter(Boolean);
  for(const [i,r] of rows.entries()){const [iid,q]=r.split('|'); const qn=Number(q); const min=i%3===0?Math.ceil(qn+between(2,10)):Math.max(2,Math.floor(qn/2)); await admin('PUT',`/inventory/item-thresholds/${wid}/${iid}`,{minQuantity:min,reorderQuantity:min*2,maxQuantity:min*6}); th++;}}
console.log('thresholds',th);
try{const sc=await admin('POST','/notifications/scan',{}); console.log('scan',JSON.stringify(sc).slice(0,200));}catch(e){console.log('scan err',e.message.slice(0,200))}
save('S',S);
