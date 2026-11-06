'use strict';
// Only invoked by the isolated native PG upgrade fixture. Service operations
// use real Prisma transactions; no JWT, Flutter, crash or direct-SQL proof.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function verifyAccountPostingRaces({prisma,chart,posting,company,branch,user}) {
  const makeAccount=async suffix => chart.create(company,user,{code:`SYN-LOCK-${suffix}`,
    nameEn:'Synthetic account',nameAr:'حساب تجريبي',type:'ASSET',isPostable:true});
  const opposite=await makeAccount('OPPOSITE');
  const makeRequest=(accountId,sourceId)=>({companyId:company,branchId:branch,userId:user,
    entryDate:new Date('2001-01-01T00:00:00.000Z'),description:'Synthetic lock test',
    sourceType:'MANUAL',sourceId,sourceNumber:'SYN-LOCK',lines:[
      {accountId,debit:'1'},{accountId:opposite.id,credit:'1'},
    ]});
  const lockWait=async (fragment,pending) => {
    const deadline=Date.now()+8000;
    while(Date.now()<deadline && pending()) {
      const rows=await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'
        AND query ILIKE '%accounts%' AND query ILIKE ${'%' + fragment + '%'}`;
      if(rows[0].n>0) return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('Expected a PostgreSQL account row-lock wait');
  };
  const signal=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  const timed=async (entered,task)=>{
    let timer;
    try { await Promise.race([entered,task.then(()=>{throw Error('operation completed before barrier');}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timed out waiting for account lock barrier')),15000);})]); }
    finally {clearTimeout(timer);}
  };

  // A deactivation that wins must be seen by the posting validator.
  const retired=await makeAccount('RETIRED'), sourceId=randomUUID();
  const disableGate=signal(), disableEntered=signal();
  const disable=prisma.$transaction(async tx=>{
    await tx.account.update({where:{id:retired.id},data:{isActive:false}});
    disableEntered.resolve(); await disableGate.promise;
  },{timeout:20000});
  await timed(disableEntered.promise,disable);
  let postingPending=true;
  const postAttempt=prisma.$transaction(tx=>posting.post(tx,makeRequest(retired.id,sourceId)),{timeout:20000})
    .then(value=>({value}),error=>({error})).finally(()=>{postingPending=false;});
  try {await lockWait('FOR SHARE',()=>postingPending);}
  finally {disableGate.resolve(); await disable;}
  const rejected=await postAttempt;
  assert.match(String(rejected.error?.message),/Accounts cannot receive postings/i);
  assert.equal(await prisma.journalEntry.count({where:{sourceId}}),0);

  // A posting that wins makes the history visible before soft deletion's
  // check. The attempted deletion must then fail, not orphan the ledger.
  const historical=await makeAccount('HISTORY'), postedSource=randomUUID();
  const postGate=signal(), postEntered=signal();
  const heldPost=prisma.$transaction(async tx=>{
    const result=await posting.post(tx,makeRequest(historical.id,postedSource));
    postEntered.resolve(); await postGate.promise; return result;
  },{timeout:20000});
  await timed(postEntered.promise,heldPost);
  let deletePending=true;
  const deletion=chart.remove(company,user,historical.id)
    .then(value=>({value}),error=>({error})).finally(()=>{deletePending=false;});
  try {await lockWait('FOR UPDATE',()=>deletePending);}
  finally {postGate.resolve(); await heldPost;}
  assert.match(String((await deletion).error?.message),/journal movements/i);
  assert.equal((await prisma.account.findUniqueOrThrow({where:{id:historical.id}})).deletedAt,null);
  assert.equal(await prisma.journalLine.count({where:{accountId:historical.id}}),1);

  // Creating a child waits for a first concurrent journal before deciding
  // whether to demote the parent to a grouping-only account.
  const parent=await makeAccount('PARENT'), parentSource=randomUUID();
  const parentGate=signal(), parentEntered=signal();
  const parentPost=prisma.$transaction(async tx=>{
    const result=await posting.post(tx,makeRequest(parent.id,parentSource));
    parentEntered.resolve(); await parentGate.promise; return result;
  },{timeout:20000});
  await timed(parentEntered.promise,parentPost);
  let childPending=true;
  const child=chart.create(company,user,{code:'SYN-LOCK-CHILD',nameEn:'Synthetic child',
    nameAr:'فرعي تجريبي',type:'ASSET',parentId:parent.id,isPostable:true})
    .then(value=>({value}),error=>({error})).finally(()=>{childPending=false;});
  try {await lockWait('FOR UPDATE',()=>childPending);}
  finally {parentGate.resolve(); await parentPost;}
  const childResult=await child;
  if(childResult.error) throw childResult.error;
  assert.equal(childResult.value.parentId,parent.id);
  assert.equal((await prisma.account.findUniqueOrThrow({where:{id:parent.id}})).isPostable,true);
  assert.equal(await prisma.journalLine.count({where:{accountId:parent.id}}),1);
  console.log('PASS: isolated PostgreSQL account posting/deactivation, historical soft-delete and parent demotion races under row locks; no HTTP, licence or crash proof.');
};
