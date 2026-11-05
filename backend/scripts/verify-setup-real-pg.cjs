'use strict';
// Synthetic first-run fixture. The parent creates and drops a separate empty
// database; it never signs keys or exercises real licence enforcement.
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || '');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    url.hostname !== '127.0.0.1' || url.port !== '5432' ||
    !/^\/kayan_setup_[0-9a-f]{16}$/.test(url.pathname) ||
    process.env.KAYAN_SETUP_DISPOSABLE_DATABASE !== url.pathname.slice(1) ||
    process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  throw new Error('Setup fixture requires the explicitly named disposable CI setup database');
}
require('reflect-metadata');
require('ts-node/register/transpile-only');
const { PrismaService } = require('../src/common/prisma/prisma.service');
const { AuditService } = require('../src/common/audit/audit.service');
const { SetupService } = require('../src/modules/company/setup.service');
const { ConflictException, Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { SetupController } = require('../src/modules/company/setup.controller');

const dto = { companyCode:'FIRST', companyNameEn:'Synthetic', companyNameAr:'تجريبي',
  adminUsername:'synthetic-admin', adminPassword:'synthetic-password', seedChartOfAccounts:false };
// License operations are deliberately stubbed; this test proves only setup's
// database serialization and rollback, not activation, signing or seat policy.
let reservations=0;
const licensing = { reserveSeat: async () => { reservations++; return { reserved:true }; } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };

(async () => {
  const one = new PrismaService(), two = new PrismaService();
  let release;
  try {
    await Promise.all([one.$connect(),two.$connect()]);
    const dormant = await one.company.create({data:{code:'OLD',nameEn:'Historical',nameAr:'قديم',deletedAt:new Date()}});
    const branch = await one.branch.create({data:{companyId:dormant.id,code:'OLD-B',nameEn:'History',nameAr:'تاريخ'}});
    const failedAudit = { recordRequired: async () => { throw new Error('synthetic audit failure'); } };
    await assert.rejects(new SetupService(one,failedAudit,licensing).initialSetup(dto), /synthetic audit failure/);
    assert.equal(await one.company.count({where:{deletedAt:null}}),0);
    assert.equal(reservations,0,'an audit failure must not advance the licence watermark');
    assert.equal(await one.user.count(),0);
    assert.equal(await one.role.count(),0);
    assert.ok(await one.company.findUnique({where:{id:dormant.id}}));
    assert.ok(await one.branch.findUnique({where:{id:branch.id}}));

    const entered = deferred(), gate = deferred(); release=gate.resolve;
    const realAudit = new AuditService(one);
    const heldAudit = { recordRequired: async (input,tx) => {
      await realAudit.recordRequired(input,tx);
      entered.resolve();
      await gate.promise;
    }};
    const first = new SetupService(one,heldAudit,licensing).initialSetup(dto);
    await Promise.race([entered.promise,first.then(() => { throw new Error('setup finished before audit barrier'); }, error => { throw error; })]);
    // Verify the first transaction really holds the database-wide lock.
    const lock = await two.$queryRaw`SELECT pg_try_advisory_xact_lock(172895144, 485772) AS acquired`;
    assert.equal(lock[0].acquired,false);
    const attempted=deferred();
    const observedTwo = new Proxy(two, { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target,key,target);
      return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, { get(inner, property) {
        if (property !== '$executeRaw') return Reflect.get(inner,property,inner);
        return (...args) => { attempted.resolve(); return inner.$executeRaw(...args); };
      }})),options);
    }});
    let settled=false;
    const second = new SetupService(observedTwo,new AuditService(two),licensing).initialSetup({...dto,companyCode:'SECOND'})
      .then(value => { settled=true; return {value}; }, error => { settled=true; return {error}; });
    await Promise.race([attempted.promise,second.then(() => { throw new Error('second setup finished without reaching lock'); })]);
    await new Promise(resolve => setTimeout(resolve,100));
    assert.equal(settled,false,'a competing setup must wait for the first transaction');
    release(); release=undefined;
    const [winner,loser] = await Promise.all([first,second]);
    assert.ok(winner.companyId);
    assert.ok(loser.error instanceof ConflictException);
    assert.equal(reservations,1);
    assert.equal(await one.company.count({where:{deletedAt:null}}),1);
    assert.equal(await one.user.count(),1);
    assert.equal(await one.auditLog.count({where:{companyId:winner.companyId,entity:'companies',action:'CREATE'}}),1);
    assert.ok(await one.company.findUnique({where:{id:dormant.id}}));
    assert.ok(await one.branch.findUnique({where:{id:branch.id}}));
    class SetupFixtureModule {}
    Module({controllers:[SetupController],providers:[{provide:SetupService,useValue:new SetupService(two,new AuditService(two),licensing)}]})(SetupFixtureModule);
    const app=await NestFactory.create(SetupFixtureModule,{logger:false});
    try {
      app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true}));
      await app.listen(0,'127.0.0.1');
      const response=await fetch(`http://127.0.0.1:${app.getHttpServer().address().port}/setup/initial`, {
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...dto,companyCode:'THIRD'})
      });
      assert.equal(response.status,409);
      assert.equal(await one.company.count({where:{deletedAt:null}}),1);
    } finally { await app.close(); }
    console.log('PASS: real PostgreSQL setup audit rollback, dormant-history preservation, two-client serialization and HTTP conflict; licensing stubbed.');
  } finally {
    if (release) release();
    await Promise.all([one.$disconnect(),two.$disconnect()]);
  }
})().catch(error => { console.error(error); process.exitCode=1; });
