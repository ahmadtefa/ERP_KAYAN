const {fork}=require('child_process');const {Client}=require('pg');
const url=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||new URL(url||'').pathname!=='/erp_kayan_acceptance')throw Error('Isolated acceptance database required');
const children=[];const events=new Map();
const wait=(c,kind,ms=15000)=>new Promise((resolve,reject)=>{const existing=(events.get(c)||[]).find(x=>x.event===kind);if(existing)return resolve(existing);const t=setTimeout(()=>reject(Error('Timeout '+kind)),ms);const f=x=>{if(x.event===kind){clearTimeout(t);c.off('message',f);resolve(x)}};c.on('message',f)});
async function child(actor){const c=fork(require('path').join(__dirname,'barrier-child-proof.cjs'),[],{env:{...process.env,DATABASE_URL:url,PROBE_ACTOR:actor,BARRIER_POOL_MAX:'2'},stdio:['ignore','pipe','pipe','ipc']});children.push(c);events.set(c,[]);c.on('message',x=>events.get(c).push(x));c.stderr.on('data',x=>process.stderr.write(x));const ready=await wait(c,'ready');return {c,port:ready.port}}
(async()=>{const db=new Client({connectionString:url});await db.connect();let key;try{
require('ts-node/register/transpile-only');key=require('../src/common/maintenance/lock-keys.ts').BUSINESS_BARRIER_KEY;
await db.query('DROP TABLE IF EXISTS barrier_write_probe');await db.query('CREATE TABLE barrier_write_probe(actor text)');
const a=await child('A'),b=await child('B');
const ra=fetch(`http://127.0.0.1:${a.port}/write`).catch(()=>null);const rb=fetch(`http://127.0.0.1:${b.port}/write`).catch(()=>null);await wait(a.c,'admitted');await wait(b.c,'admitted');
const free=async()=>{const x=(await db.query('SELECT pg_try_advisory_lock($1) AS ok',[key])).rows[0].ok;if(x)await db.query('SELECT pg_advisory_unlock($1)',[key]);return x};
if(await free())throw Error('Restore passed active handlers');
await db.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'kayan-api-%-barrier' AND pid<>pg_backend_pid()");
const exits=await Promise.all([a,b].map(x=>new Promise(r=>x.c.exitCode!==null?r(x.c.exitCode):x.c.once('exit',r))));
if(exits.some(x=>x!==1))throw Error('Lost-lease processes did not fail-stop');
if((await db.query('SELECT count(*)::int AS n FROM barrier_write_probe')).rows[0].n!==0)throw Error('Handler mutated after lease loss');
if(!await free())throw Error('Locks not released after process exit');
console.log(JSON.stringify({twoApiProcesses:true,exclusiveDeniedWhileHandlersActive:true,realLeaseTermination:true,exitCodes:exits,writeRowsAfterExit:0,restoreAvailableAfterExit:true}));
const d=await child('drain');const rd=fetch(`http://127.0.0.1:${d.port}/write`);await wait(d.c,'admitted');d.c.send('shutdown');await new Promise(r=>setTimeout(r,300));if(await free())throw Error('Shutdown exposed restore while handler active');d.c.send('continue');await rd;await wait(d.c,'shutdown-drained');if(!await free())throw Error('Shutdown failed to drain');const rows=(await db.query('SELECT actor FROM barrier_write_probe')).rows;if(rows.length!==1||rows[0].actor!=='drain')throw Error('Wrong mutation order');console.log(JSON.stringify({shutdownHeldLockDuringHandler:true,writeCompletedBeforeDrain:true,restoreAvailableAfterDrain:true,rows}));d.c.send('close');
}finally{for(const c of children)if(c.exitCode===null)c.kill('SIGKILL');await db.query('DROP TABLE IF EXISTS barrier_write_probe');await db.end()}})().catch(e=>{console.error(e);process.exit(1)});
