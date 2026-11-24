// Isolated proof harness, not product startup/auth/licensing acceptance.
require('ts-node/register/transpile-only');
const http=require('http');const {Client}=require('pg');
const {DatabaseMaintenanceBarrier}=require('../src/common/maintenance/database-barrier.ts');
const barrier=new DatabaseMaintenanceBarrier();
const db=new Client({connectionString:process.env.DATABASE_URL});
(async()=>{await db.connect();let continueWrite;
const server=http.createServer(async(req,res)=>{
 try{
  const release=await barrier.admit();
  if(process.send)process.send({event:'admitted'});
  await new Promise(r=>continueWrite=r);
  await db.query(`INSERT INTO barrier_write_probe (actor) VALUES ($1)`,[process.env.PROBE_ACTOR]);
  await release();res.end('wrote');
 }catch(e){res.statusCode=503;res.end('refused')}
});
process.on('message',async(msg)=>{
 if(msg==='continue')continueWrite?.();
 if(msg==='shutdown') {await barrier.onModuleDestroy();process.send?.({event:'shutdown-drained'});}
 if(msg==='close'){server.close();await db.end();process.exit(0);}
});server.listen(0,'127.0.0.1',()=>process.send?.({event:'ready',port:server.address().port}));
})().catch(()=>process.exit(2));
