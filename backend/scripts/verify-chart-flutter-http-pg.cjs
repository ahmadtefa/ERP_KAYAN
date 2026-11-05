'use strict';
// An isolated Flutter widget + real HTTP + PostgreSQL chart integration.
// The identity middleware is synthetic. JWT, licensing, device and installer
// behavior are deliberately outside this proof; no credentials or signatures.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, Reflector } = require('@nestjs/core');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard');
const { ProblemDetailsFilter } = require('../src/common/filters/problem-details.filter');
const { ChartOfAccountsService } = require('../src/modules/accounting/chart-of-accounts.service');
const { ChartOfAccountsController } = require('../src/modules/accounting/chart-of-accounts.controller');

module.exports = async function chartFlutterHttpPg({prisma,chart,company,user,branch}) {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      url.hostname !== '127.0.0.1' || url.port !== '5432' ||
      !/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname) ||
      process.env.KAYAN_STOCK_DISPOSABLE_DATABASE !== url.pathname.slice(1) ||
      process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    throw new Error('Flutter chart integration requires the isolated native PostgreSQL CI fixture');
  }
  const code='SYN-UI-ACCOUNT-1';
  assert.equal(await prisma.account.count({where:{companyId:company,code}}),0);
  class ChartFlutterFixtureModule {}
  Module({controllers:[ChartOfAccountsController],providers:[{provide:ChartOfAccountsService,useValue:chart}]})(ChartFlutterFixtureModule);
  const app=await NestFactory.create(ChartFlutterFixtureModule,{logger:false});
  const requests={list:0,create:0,update:0,suggest:0};
  app.use((req,_res,next)=>{
    req.user={companyId:company,userId:user,branchId:branch,isSuperAdmin:false,
      permissions:['accounting.accounts.read','accounting.accounts.create','accounting.accounts.update']};
    if (req.method==='GET' && req.path==='/accounting/chart-of-accounts') requests.list++;
    if (req.method==='GET' && req.path==='/accounting/chart-of-accounts/suggest-code') requests.suggest++;
    if (req.method==='POST' && req.path==='/accounting/chart-of-accounts') requests.create++;
    if (req.method==='PATCH' && req.path.startsWith('/accounting/chart-of-accounts/')) requests.update++;
    next();
  });
  app.useGlobalGuards(new PermissionsGuard(new Reflector()));
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ProblemDetailsFilter());
  try {
    await app.listen(0,'127.0.0.1');
    const origin=`http://127.0.0.1:${app.getHttpServer().address().port}`;
    const env={...process.env,KAYAN_CHART_INTEGRATION:'disposable-ci',KAYAN_CHART_INTEGRATION_ORIGIN:origin};
    // The client process does not need direct database access or its URL.
    delete env.DATABASE_URL; delete env.KAYAN_TEST_ADMIN_URL; delete env.KAYAN_STOCK_DISPOSABLE_DATABASE;
    const child=spawn('flutter',['test','--no-pub','--reporter','expanded','integration/real_chart_http_pg_test.dart'],{
      cwd:path.resolve(__dirname,'../..'),env,stdio:['ignore','pipe','pipe'],
    });
    let output='';
    const append=chunk=>{ output=(output+chunk.toString()).slice(-16000); };
    child.stdout.on('data',append); child.stderr.on('data',append);
    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL'); reject(new Error('Flutter chart integration timed out'));},180000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal});});
    });
    if (result.status!==0) throw new Error(`Flutter chart integration failed (${result.status ?? result.signal}):\n${output}`);
    const saved=await prisma.account.findFirstOrThrow({where:{companyId:company,code}});
    assert.equal(saved.nameEn,'Integration asset revised');
    assert.equal(saved.isActive,true);
    assert.equal(saved.nameAr,'حساب تكامل تجريبي');
    assert.equal(saved.type,'ASSET');
    assert.equal(await prisma.account.count({where:{companyId:company,code}}),1);
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'accounts',entityId:saved.id,action:'CREATE'}}),1);
    assert.ok(requests.list>=2,`expected initial list and refresh, got ${requests.list}`);
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'accounts',entityId:saved.id,action:'UPDATE'}}),3);
    assert.equal(requests.create,1);
    assert.equal(requests.update,3);
    assert.ok(requests.suggest>=1);
    console.log('PASS: Flutter chart widget created, edited, deactivated, activated and reloaded a real PostgreSQL account over HTTP; principal injected, no JWT/licence/installed UI.');
  } finally { await app.close(); }
};
