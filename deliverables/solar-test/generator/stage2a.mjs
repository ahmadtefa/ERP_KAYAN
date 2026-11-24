import {login,api,save,load} from './lib.mjs'; import {between,pick,R} from './data.mjs'; import fs from 'node:fs';
await login('admin',fs.readFileSync('/tmp/gen/admin.pw','utf8').trim()); const S=load('S');
// stock model: qty per warehouse:item
const Q={}; const key=(w,i)=>w+':'+i; S.qty=Q;
const mainOf={HQ:'HQ-MAIN',ALX:'ALX-MAIN',MNS:'MNS-MAIN',AST:'AST-MAIN',HRG:'HRG-MAIN'};
const scale={HQ:1,ALX:0.6,MNS:0.4,AST:0.3,HRG:0.3};
for(const b of Object.keys(mainOf)){
  const lines=[]; const wid=S.wh[mainOf[b]];
  for(const it of S.items){ const base=it.cat==='PNL'?between(40,160):it.cat==='INV'?between(5,25):it.cat==='BAT'?between(4,20):it.cat==='MNT'?between(20,90):it.cat==='CAB'||it.cat==='PRT'?between(15,80):it.cat==='TLS'?between(30,120):between(6,40);
    const q=Math.max(2,Math.round(base*scale[b])); Q[key(wid,it.id)]=q;
    lines.push({accountId:S.acc['1104'],itemId:it.id,quantity:String(q),unitCost:String(it.cost),debit:(q*it.cost).toFixed(2)}); }
  const cash={HQ:[250000,3500000],ALX:[80000,900000],MNS:[60000,600000],AST:[50000,400000],HRG:[50000,400000]}[b];
  lines.push({accountId:S.acc['1101'],debit:String(cash[0])},{accountId:S.acc['1102'],debit:String(cash[1])});
  if(b==='HQ') lines.push({accountId:S.acc['1202'],debit:'650000'},{accountId:S.acc['1204'],debit:'180000'});
  const d=await api('POST','/accounting/opening-balances',{asOfDate:'2025-12-31',branchId:S.branches[b],warehouseId:wid,description:`أرصدة افتتاحية - ${b}`,autoBalanceToEquity:true,lines});
  const p=await api('POST','/accounting/opening-balances/'+d.id+'/post',{}); console.log(b,'opening posted',p.status||'ok');
}
save('S',S);
