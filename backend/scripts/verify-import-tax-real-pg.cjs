'use strict';
// Called only by the fail-closed disposable PostgreSQL upgrade fixture.
// Real HTTP/controller/import service and PG; principal is injected, no JWT.
const assert = require('node:assert/strict');
const {Module} = require('@nestjs/common');
const {NestFactory} = require('@nestjs/core');
const {ImportController} = require('../src/modules/import/import.controller');
const {ImportService} = require('../src/modules/import/import.service');
module.exports = async ({prisma,audit,company,branch,user}) => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      url.hostname !== '127.0.0.1' || url.port !== '5432' ||
      !/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname) ||
      process.env.KAYAN_STOCK_DISPOSABLE_DATABASE !== url.pathname.slice(1) ||
      process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    throw new Error('Import tax test requires the isolated native PostgreSQL CI fixture');
  }
  const code='SYN-IMPORT-TAX';
  const item=await prisma.item.create({data:{companyId:company,code,nameEn:'Synthetic',nameAr:'تجريبي',unit:'piece',taxRate:'14'}});
  const service = new ImportService(prisma,audit,{});
  class Fixture {}
  Module({controllers:[ImportController],providers:[{provide:ImportService,useValue:service}]})(Fixture);
  const app=await NestFactory.create(Fixture,{logger:false});
  let permissions=['inventory.items.create','inventory.items.update'];
  app.use((req,_res,next)=>{req.user={companyId:company,userId:user,branchId:branch,isSuperAdmin:false,permissions};next();});
  try {
    await app.listen(0,'127.0.0.1');
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/import/items`;
    const send=async (csv,params) => {
      const form=new FormData(); form.append('file',new Blob([csv],{type:'text/csv'}),'items.csv');
      const response=await fetch(base+'?'+new URLSearchParams(params),{method:'POST',body:form});
      return {status:response.status,body:await response.json()};
    };
    const current=async () => (await prisma.item.findUniqueOrThrow({where:{id:item.id}})).taxRate.toFixed(4);
    const absent=`Code,Name (English),Name (Arabic)\n${code},Synthetic,تجريبي\n`;
    const withTax=value=>`Code,Name (English),Name (Arabic),Tax rate %\n${code},Synthetic,تجريبي,${value}\n`;
    const baseParams={mode:'upsert',dryRun:'false'};
    permissions=['inventory.items.create'];
    assert.equal((await send(withTax(''),{...baseParams,clearBlankTaxRates:'true'})).status,403);
    assert.equal(await current(),'14.0000');
    permissions.push('inventory.items.update');
    assert.equal((await send(absent,{...baseParams,clearBlankTaxRates:'true'})).status,201);
    assert.equal(await current(),'14.0000');
    assert.equal((await send(withTax('  '),{...baseParams,clearBlankTaxRates:'false'})).status,201);
    assert.equal(await current(),'14.0000');
    const dry=await send(withTax('  '),{...baseParams,dryRun:'true',clearBlankTaxRates:'true'});
    assert.equal(dry.status,201); assert.equal(dry.body.clearedBlankTaxRates,1);
    assert.equal(await current(),'14.0000');
    const committed=await send(withTax('  '),baseParams);
    assert.equal(committed.status,201); assert.equal(committed.body.clearedBlankTaxRates,1);
    assert.equal(await current(),'0.0000');
    for(const [value,expected] of [['5','5.0000'],['0','0.0000'],['14','14.0000']]) {
      assert.equal((await send(withTax(value),baseParams)).status,201);
      assert.equal(await current(),expected);
    }
    const invalid=await send(withTax('101'),baseParams);
    assert.equal(invalid.status,201); assert.equal(invalid.body.errors.length,1);
    assert.equal(await current(),'14.0000');
    console.log('PASS: isolated real HTTP/PG item tax import: omitted, protected blank, blank preview/default commit, zero, rates, validation and permission denial; principal injected.');
  } finally { await app.close(); }
};
