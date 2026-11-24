import fs from 'node:fs'; import crypto from 'node:crypto'; import {execSync,spawn} from 'node:child_process';
const APW=fs.readFileSync('/tmp/gen/admin.pw','utf8').trim(); const cr=JSON.parse(fs.readFileSync('/tmp/gen/credentials.json','utf8'));
const PS='PGPASSWORD=\$KAYAN_PG_PASSWORD psql -h 127.0.0.1 -p 55432 -U kayan -Atq';
const sh=c=>execSync(c,{encoding:'utf8',maxBuffer:1<<28}).trim();
const out={checks:[]}; const check=(n,ok,d)=>{out.checks.push({n,ok:!!ok,d});console.log(ok?'PASS':'FAIL',n,d??'');};
const call=async(base,method,path,tok,body)=>{const r=await fetch(base+path,{method,headers:{...(tok?{authorization:'Bearer '+tok}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{status:r.status,j}};
const CIPW=crypto.randomBytes(18).toString('base64url')+'Aa1';
const SRC='http://127.0.0.1:3999/api/v1', DST='http://127.0.0.1:3998/api/v1';
const login=async(b,u,p)=>(await call(b,'POST','/auth/login',null,{username:u,password:p})).j.accessToken;
const tok=await login(SRC,'admin',APW);
// 1. dump via the program's own route
const cap=await call(SRC,'GET','/backup/full/capabilities',tok); check('backup capabilities available',cap.j.available!==false,JSON.stringify(cap.j).slice(0,160));
const mk=await call(SRC,'POST','/backup/full/database-archive',tok,{}); console.log(JSON.stringify(mk.j).slice(0,300));
const name=mk.j.file?.name||mk.j.name; check('program creates the dump via /backup/full/database-archive',mk.status<300&&name,name);
const ver=await call(SRC,'POST',`/backup/full/${encodeURIComponent(name)}/verify`,tok,{}); check('program verifies the dump',ver.j.archiveContentReadable===true,JSON.stringify(ver.j).slice(0,200));
const dl=await fetch(SRC+`/backup/full/${encodeURIComponent(name)}/download`,{headers:{authorization:'Bearer '+tok}}); const buf=Buffer.from(await dl.arrayBuffer());
fs.mkdirSync('/tmp/out',{recursive:true}); fs.writeFileSync('/tmp/out/KAYAN-SOLAR-TEST.dump',buf);
out.sha256=crypto.createHash('sha256').update(buf).digest('hex'); out.bytes=buf.length; check('dump is PostgreSQL custom format',buf.subarray(0,5).toString('latin1')==='PGDMP',out.bytes+' bytes');
const lst=sh('pg_restore --list /tmp/out/KAYAN-SOLAR-TEST.dump | grep -c "TABLE DATA"'); check('pg_restore --list reads it',Number(lst)>20,lst+' table-data entries');
// 2. source counts
const TABLES=['branches','warehouses','items','customers','suppliers','users','cost_centers','sales_invoices','sales_invoice_lines','purchase_invoices','purchase_invoice_lines','stock_transfers','stock_transfer_lines','stock_movements','warehouse_stock_balances','journal_entries','journal_lines','accounts','cash_vouchers','approval_policies','notifications','item_warehouse_settings','roles','item_categories','opening_balances'];
const counts=(db)=>Object.fromEntries(TABLES.map(t=>{try{return[t,Number(sh(`${PS} -d ${db} -c "select count(*) from ${t}"`))]}catch{return[t,null]}}));
out.srcCounts=counts('kayan_solar_build'); console.log(JSON.stringify(out.srcCounts));
const tb0=(await call(SRC,'GET','/reports/trial-balance?from=2000-01-01&to=2099-12-31',tok)).j; const tot=j=>{let d=0,c=0;for(const r of j.rows){d+=Number(r.debit);c+=Number(r.credit)}return{debit:d.toFixed(4),credit:c.toFixed(4),difference:(d-c).toFixed(4),rows:j.rows.length}};out.tbSrc=tot(tb0);
// 3. restore target
sh(`${PS} -d postgres -c 'drop database if exists kayan_solar_restore' -c 'create database kayan_solar_restore'`);
const env={...process.env,DATABASE_URL:`postgresql://kayan:${process.env.KAYAN_PG_PASSWORD}@127.0.0.1:55432/kayan_solar_restore?schema=public`};
execSync('cd /tmp/kayan/backend && node scripts/apply-migrations.mjs > /dev/null',{env});
fs.rmSync('/tmp/kbackups2',{recursive:true,force:true}); fs.mkdirSync('/tmp/kbackups2',{recursive:true});
const api=spawn('node',['dist/src/main.js'],{cwd:'/tmp/kayan/backend',env:{...env,KAYAN_BACKUP_DIR:'/tmp/kbackups2',PORT:'3998',HOST:'127.0.0.1',NODE_ENV:'development',RATE_LIMIT_ENABLED:'false',JWT_ACCESS_SECRET:crypto.randomBytes(32).toString('hex'),JWT_REFRESH_SECRET:crypto.randomBytes(32).toString('hex'),JWT_ACCESS_TTL:'3600',JWT_REFRESH_TTL:'604800'},stdio:['ignore','pipe','pipe']});
let log=''; api.stdout.on('data',d=>log+=d); api.stderr.on('data',d=>log+=d);
for(let i=0;i<60;i++){try{if((await fetch(DST+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,1000));}
const setup=await call(DST,'POST','/setup/initial',null,{companyCode:'RESTORE-CI',companyNameEn:'Disposable restore target',companyNameAr:'شركة اختبار الاسترجاع',facilityKind:'HEADQUARTERS',unitCode:'MAIN',unitNameEn:'Head Office',unitNameAr:'المركز الرئيسي',adminUsername:'restore-ci',adminPassword:CIPW,seedChartOfAccounts:true}); check('fresh destination installation set up',setup.status<300,'HTTP '+setup.status);
const dtok=await login(DST,'restore-ci',CIPW);
const form=new FormData(); form.append('confirm','true'); form.append('file',new Blob([buf]),'KAYAN-SOLAR-TEST.dump');
const rs=await call(DST,'POST','/backup/full/restore?confirm=true',dtok,form); console.log(JSON.stringify(rs.j).slice(0,500));
check('dump restores through the real backend route /backup/full/restore',rs.status<300,'HTTP '+rs.status+' '+JSON.stringify(rs.j).slice(0,160));
// wait for restore to finish
for(let i=0;i<60;i++){const st=await call(DST,'GET','/backup/full/status',dtok).catch(()=>null); if(!st||st.status===401||!st.j?.running)break; await new Promise(r=>setTimeout(r,1000));}
await new Promise(r=>setTimeout(r,3000));
// 4. verification
out.dstCounts=counts('kayan_solar_restore'); const same=TABLES.filter(t=>out.srcCounts[t]!==out.dstCounts[t]); check('row counts identical in restored DB',same.length===0,same.length?JSON.stringify(same.map(t=>[t,out.srcCounts[t],out.dstCounts[t]])):'all '+TABLES.length+' tables equal');
let okLogins=0; const bad=[]; for(const c of cr){const t=await login(DST,c.username,c.password); if(t)okLogins++; else bad.push(c.username);} check('all test users can sign in after restore',okLogins===cr.length,okLogins+'/'+cr.length+(bad.length?' failed:'+bad:''));
const t2=await login(DST,'admin',APW); const tb1=(await call(DST,'GET','/reports/trial-balance?from=2000-01-01&to=2099-12-31',t2)).j; out.tbDst=tot(tb1);
check('trial balance balances and equals source',Math.abs(Number(out.tbDst.difference))<0.005&&JSON.stringify(out.tbDst)===JSON.stringify(out.tbSrc),JSON.stringify(out.tbDst));
const sales=(await call(DST,'GET','/sales/invoices?pageSize=1',t2)).j; out.apiSalesTotal=sales.total; check('restored API serves sales invoices',sales.total>0,'total '+sales.total);
fs.writeFileSync('/tmp/out/restore-test-result.json',JSON.stringify(out,null,1)); api.kill(); 
console.log(out.checks.every(c=>c.ok)?'ALL PASS':'SOME FAILED');
