'use strict';
// Run only inside verify-prisma-native-upgrade's disposable GitHub-hosted DB.
// Production StockDocumentsService, Prisma adapter, posting, warehouse,
// accounts and cost-center services all execute against real PostgreSQL.
// This is not an HTTP, Flutter, installed-product or licensing test.
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || '');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    url.hostname !== '127.0.0.1' || url.port !== '5432' ||
    !/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname) ||
    process.env.KAYAN_STOCK_DISPOSABLE_DATABASE !== url.pathname.slice(1)) {
  throw new Error('Stock fixture requires the explicitly named disposable GitHub PostgreSQL database');
}
if (process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  throw new Error('Prisma engine overrides are forbidden');
}
require('reflect-metadata');
require('ts-node/register/transpile-only');
const { Client } = require('pg');
const { PrismaService } = require('../src/common/prisma/prisma.service');
const { AuditService } = require('../src/common/audit/audit.service');
const { CompanySettingsService } = require('../src/common/settings/company-settings.module');
const { WarehouseService } = require('../src/common/warehouse/warehouse.service');
const { CostCentersService } = require('../src/modules/accounting/cost-centers.service');
const { BudgetsService } = require('../src/modules/accounting/budgets.service');
const { FiscalPeriodsService } = require('../src/modules/accounting/fiscal-periods.service');
const { YearEndCloseService } = require('../src/modules/accounting/year-end-close.service');
const { DocumentNumberService } = require('../src/modules/accounting/document-number.service');
const { AccountMapService } = require('../src/modules/accounting/account-map.service');
const { PostingService } = require('../src/modules/accounting/posting.service');
const { JournalEntriesService } = require('../src/modules/accounting/journal-entries.service');
const { JournalEntriesController } = require('../src/modules/accounting/journal-entries.controller');
const { StockDocumentsService } = require('../src/modules/inventory/stock-documents.service');
const { StockLedgerService } = require('../src/common/warehouse/stock-ledger.service');
const { BatchesService } = require('../src/modules/inventory/batches.service');
const { ItemsService } = require('../src/modules/inventory/items.service');
const { ItemsController } = require('../src/modules/inventory/items.controller');
const { InventoryReportsController } = require('../src/modules/inventory/inventory-reports.controller');
const { InventoryReportsService } = require('../src/modules/inventory/inventory-reports.service');
const { BarcodeLabelsService } = require('../src/modules/inventory/barcode-labels.service');
const { DocumentsService } = require('../src/modules/export/documents.service');
const { ChartOfAccountsService } = require('../src/modules/accounting/chart-of-accounts.service');
const { ChartOfAccountsController } = require('../src/modules/accounting/chart-of-accounts.controller');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ProblemDetailsFilter } = require('../src/common/filters/problem-details.filter');
const { StockService } = require('../src/modules/inventory/stock.service');
const { FinancialStatementsService } = require('../src/modules/reports/financial-statements.service');
const { ReportsService } = require('../src/modules/reports/reports.service');
const { PriceListsService } = require('../src/modules/sales/price-lists.service');
const { SalesOrdersService } = require('../src/modules/sales/sales-orders.service');
const { PurchaseOrdersService } = require('../src/modules/purchases/purchase-orders.service');
const { SalesInvoicesService } = require('../src/modules/sales/sales-invoices.service');
const { SalesInvoicesController } = require('../src/modules/sales/sales-invoices.controller');
const { PurchaseInvoicesService } = require('../src/modules/purchases/purchase-invoices.service');
const { PurchaseInvoicesController } = require('../src/modules/purchases/purchase-invoices.controller');
const { ReturnsService } = require('../src/modules/returns/returns.service');
const { ProfilePhotoService } = require('../src/modules/auth/profile-photo.service');
const { RolesService } = require('../src/modules/admin/roles.service');
const { UsersService } = require('../src/modules/admin/users.service');
const { normalizeLogo, CompanyService } = require('../src/modules/company/company.service');
const { CompanyController } = require('../src/modules/company/company.controller');
const { CompaniesController } = require('../src/modules/company/companies.controller');
const { AccountingSettingsController } = require('../src/modules/accounting/settings.controller');
const { BackupScheduleController } = require('../src/modules/backup/backup-schedule.controller');
const { BackupScheduleService } = require('../src/modules/backup/backup-schedule.service');
const { AuditedSuperAdminGuard } = require('../src/common/guards/audited-super-admin.guard');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard');
const { Reflector } = require('@nestjs/core');
const sharp = require('sharp');

const company = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const item = '30000000-0000-4000-8000-000000000001';
const branch = '70000000-0000-4000-8000-000000000001';
const warehouse = '70000000-0000-4000-8000-000000000002';
const centre = '70000000-0000-4000-8000-000000000003';
let inventory = '70000000-0000-4000-8000-000000000004';
let difference = '70000000-0000-4000-8000-000000000005';

(async () => {
  const sql = new Client({ connectionString: url.toString() });
  const prisma = new PrismaService();
  try {
    await sql.connect();
    // The company, user and item were populated by the native upgrade fixture.
    await sql.query('INSERT INTO branches (id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [branch,company,'B','Synthetic branch','فرع تجريبي']);
    await sql.query('INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,true,now())', [warehouse,company,branch,'W','Synthetic warehouse','مخزن تجريبي']);
    await sql.query('INSERT INTO cost_centers (id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [centre,company,'CC','Synthetic center','مركز تجريبي']);
    // Upgrade migrations may already seed either conventional account. Reuse
    // its actual id rather than inserting a duplicate company/code pair.
    const accounts = await sql.query('INSERT INTO accounts (id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now()),($7,$2,$8,$9,$10,$11,now()) ON CONFLICT ("companyId",code) DO UPDATE SET "isActive"=true,"isPostable"=true,"deletedAt"=NULL,"updatedAt"=now() RETURNING id,code', [inventory,company,'1104','Inventory','مخزون','ASSET',difference,'5107','Inventory difference','فرق مخزون','EXPENSE']);
    inventory = accounts.rows.find(row => row.code === '1104').id;
    difference = accounts.rows.find(row => row.code === '5107').id;
    await prisma.$connect();
    const audit = new AuditService(prisma);
    // Real database persistence and transaction rollback for a synthetic user's
    // self-service photo, with tenant and account isolation. No real image data.
    const photos = new ProfilePhotoService(prisma,audit);
    const image = await sharp({create:{width:32,height:32,channels:3,background:'#abc123'}}).png().toBuffer();
    const replacementImage = await sharp({create:{width:32,height:32,channels:3,background:'#1234ef'}}).png().toBuffer();
    const initialAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (input,tx) => {
      if (input.action === 'PROFILE_PHOTO_SET') throw new Error('injected initial photo audit failure');
      return initialAudit(input,tx);
    };
    try {
      await assert.rejects(photos.set(company,user,image,'image/png'),/injected initial photo audit failure/);
      assert.equal((await photos.get(company,user)).data,null);
    } finally { audit.recordRequired = initialAudit; }
    await photos.set(company,user,image,'image/png');
    const savedPhoto = await photos.get(company,user);
    assert.equal(savedPhoto.mime,'image/webp'); assert.ok(savedPhoto.data);
    const replacementEncoded = await normalizeLogo(replacementImage,'image/png');
    assert.notEqual(Buffer.from(replacementEncoded.data).toString('base64'),savedPhoto.data);
    assert.equal((await photos.get('99999999-9999-4999-8999-999999999999',user)).data,null);
    assert.equal((await photos.get(company,'99999999-9999-4999-8999-999999999999')).data,null);
    const realAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (input,tx) => {
      if (input.action === 'PROFILE_PHOTO_SET' || input.action === 'PROFILE_PHOTO_REMOVE') throw new Error('injected photo audit failure');
      return realAudit(input,tx);
    };
    try {
      await assert.rejects(photos.set(company,user,replacementImage,'image/png'),/injected photo audit failure/);
      await assert.rejects(photos.remove(company,user),/injected photo audit failure/);
    } finally { audit.recordRequired = realAudit; }
    assert.deepEqual(await photos.get(company,user),savedPhoto);
    await photos.remove(company,user);
    assert.equal((await photos.get(company,user)).data,null);
    const photoAudit = await prisma.auditLog.findMany({where:{companyId:company,userId:user,action:{in:['PROFILE_PHOTO_SET','PROFILE_PHOTO_REMOVE']}}});
    assert.equal(photoAudit.length,2);
    assert.ok(!JSON.stringify(photoAudit).includes(savedPhoto.data));
    console.log('PASS: real PostgreSQL profile photo persistence, tenant isolation and audit rollback.');
    // Real HTTP controllers, real guards and actual PostgreSQL. Authentication
    // is intentionally a synthetic injected principal; JWT and installed
    // product/license behavior are not exercised by this fixture.
    const companies = new CompanyService(prisma,audit);
    const companySettings = new CompanySettingsService(prisma,audit);
    const companyBefore = await prisma.company.findUniqueOrThrow({where:{id:company}});
    assert.equal(companyBefore.logoPath,null);
    assert.equal(companyBefore.logoData,null);
    const settingsBefore = await companySettings.get(company);
    let scheduleRuns=0, schedulePrunes=0;
    const scheduleFixture={status:async()=>({retentionCount:1}),history:async()=>[],
      runNow:async()=>{scheduleRuns++;return [];},pruneRetention:async()=>{schedulePrunes++;return [];}};
    class CompanyHttpFixtureModule {}
    Module({controllers:[CompanyController,CompaniesController,AccountingSettingsController,BackupScheduleController],providers:[
      AuditedSuperAdminGuard,{provide:AuditService,useValue:audit},{provide:PrismaService,useValue:prisma},
      {provide:CompanyService,useValue:companies},{provide:CompanySettingsService,useValue:companySettings},
      {provide:BackupScheduleService,useValue:scheduleFixture},
    ]})(CompanyHttpFixtureModule);
    const companyHttp = await NestFactory.create(CompanyHttpFixtureModule,{logger:false});
    try {
      companyHttp.use((req,_res,next)=>{req.user={userId:user,companyId:company,branchId:branch,username:'synthetic',
        isSuperAdmin:req.headers['x-fixture-super']==='yes',permissions:['admin.company.manage','company.profile.manage','reports.read','admin.backup']};next();});
      companyHttp.useGlobalGuards(new PermissionsGuard(new Reflector()));
      companyHttp.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      companyHttp.useGlobalFilters(new ProblemDetailsFilter());
      await companyHttp.listen(0,'127.0.0.1');
      const base=`http://127.0.0.1:${companyHttp.getHttpServer().address().port}`;
      const patch=(path,body,superAdmin)=>fetch(base+path,{method:'PATCH',headers:{'content-type':'application/json',
        'x-fixture-super':superAdmin?'yes':'no'},body:JSON.stringify(body)});
      const deniedBefore=await prisma.auditLog.count({where:{companyId:company,userId:user,entity:'super_admin_access',action:'ACCESS_DENIED'}});
      for (const prefix of ['/company','/companies']) {
        const beforeName=(await prisma.company.findUniqueOrThrow({where:{id:company}})).nameEn;
        const auditBefore=await prisma.auditLog.count({where:{companyId:company,entity:'companies'}});
        assert.equal((await patch(`${prefix}/profile`,{nameEn:'Unauthorized change'},false)).status,403);
        assert.equal((await prisma.company.findUniqueOrThrow({where:{id:company}})).nameEn,beforeName);
        assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'companies'}}),auditBefore);
        assert.equal((await patch(`${prefix}/profile`,{nameEn:'Synthetic company updated'},true)).status,200);
        assert.equal((await prisma.company.findUniqueOrThrow({where:{id:company}})).nameEn,'Synthetic company updated');
        const upload=superAdmin=>{
          const form=new FormData();form.set('file',new Blob([image],{type:'image/png'}),'synthetic.png');
          return fetch(base+prefix+'/logo',{method:'POST',headers:{'x-fixture-super':superAdmin?'yes':'no'},body:form});
        };
        assert.equal((await upload(false)).status,403);
        assert.equal((await prisma.company.findUniqueOrThrow({where:{id:company}})).logoData,null);
        assert.equal((await upload(true)).status,201);
        const stored=(await prisma.company.findUniqueOrThrow({where:{id:company}})).logoData;
        assert.ok(stored?.length);
        assert.equal((await fetch(base+prefix+'/logo',{method:'DELETE',headers:{'x-fixture-super':'no'}})).status,403);
        assert.deepEqual((await prisma.company.findUniqueOrThrow({where:{id:company}})).logoData,stored);
        assert.equal((await fetch(base+prefix+'/logo',{method:'DELETE',headers:{'x-fixture-super':'yes'}})).status,200);
        assert.equal((await prisma.company.findUniqueOrThrow({where:{id:company}})).logoData,null);
      }
      const policyAudits=await prisma.auditLog.count({where:{companyId:company,entity:'company_settings'}});
      assert.equal((await patch('/accounting/settings',{managerName:'Unauthorized manager'},false)).status,403);
      assert.equal((await companySettings.get(company)).managerName,settingsBefore.managerName);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'company_settings'}}),policyAudits);
      assert.equal((await patch('/accounting/settings',{managerName:'Synthetic manager'},true)).status,200);
      assert.equal((await companySettings.get(company)).managerName,'Synthetic manager');
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'company_settings'}}),policyAudits+1);
      const realSettingsAudit=audit.recordRequired.bind(audit);
      audit.recordRequired=async (entry,tx)=>{
        if(entry.entity==='company_settings') throw new Error('injected company settings audit failure');
        return realSettingsAudit(entry,tx);
      };
      try {
        await assert.rejects(companySettings.update(company,user,{managerName:'Must roll back'}),/injected company settings audit failure/);
        assert.equal((await companySettings.get(company)).managerName,'Synthetic manager');
        assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'company_settings'}}),policyAudits+1);
      } finally {audit.recordRequired=realSettingsAudit;}
      assert.equal(await prisma.auditLog.count({where:{companyId:company,userId:user,entity:'super_admin_access',action:'ACCESS_DENIED'}}),deniedBefore+7);
      const beforeDeniedAudit=audit.recordRequired.bind(audit);
      audit.recordRequired=async (entry,tx)=>{
        if(entry.entity==='super_admin_access') throw new Error('injected denial audit failure');
        return beforeDeniedAudit(entry,tx);
      };
      try {
        assert.equal((await patch('/accounting/settings',{managerName:'unauthorized'},false)).status,503);
        assert.equal((await companySettings.get(company)).managerName,'Synthetic manager');
      } finally {audit.recordRequired=beforeDeniedAudit;}
      for (const [method,route] of [['GET',''],['GET','/history'],['POST','/run'],['POST','/prune']]) {
        const send=(superAdmin)=>fetch(base+'/backup/schedule'+route,{method,
          headers:{'x-fixture-super':superAdmin?'yes':'no','content-type':'application/json'},
          ...(method==='POST'?{body:JSON.stringify({companyId:'another-company'})}:{})});
        assert.equal((await send(false)).status,403);
        assert.equal((await send(true)).status,method==='POST'?201:200);
      }
      assert.equal(scheduleRuns,1); assert.equal(schedulePrunes,1);
      const denials=await prisma.auditLog.findMany({where:{companyId:company,userId:user,entity:'super_admin_access',action:'ACCESS_DENIED'}});
      assert.equal(denials.length,deniedBefore+11);
      assert.ok(!JSON.stringify(denials).includes('Unauthorized manager'));
      assert.equal((await patch('/accounting/settings',{managerName:settingsBefore.managerName},true)).status,200);
      assert.equal((await patch('/company/profile',{nameEn:companyBefore.nameEn},true)).status,200);
      // Branch authorization and required audit, over HTTP and real PG. The
      // test principal is injected; JWT and licensing remain out of scope.
      const branchBody={code:'SYN-SEC-BRANCH',nameEn:'Synthetic secure branch',nameAr:'فرع تجريبي',
        kind:'BRANCH',parentBranchId:branch};
      const requestBranch=(method,path,body,allowed)=>fetch(base+path,{method,
        headers:{'content-type':'application/json','x-fixture-super':allowed?'yes':'no'},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const countBranches=()=>prisma.branch.count({where:{companyId:company}});
      const countWarehouses=()=>prisma.warehouse.count({where:{companyId:company}});
      const beforeBranches=await countBranches(),beforeWarehouses=await countWarehouses();
      assert.equal((await requestBranch('POST','/company/branches',branchBody,false)).status,403);
      assert.equal((await requestBranch('PATCH',`/company/branches/${branch}`,{nameEn:'No'},false)).status,403);
      assert.equal((await requestBranch('DELETE',`/company/branches/${branch}`,undefined,false)).status,403);
      assert.equal(await countBranches(),beforeBranches);
      assert.equal(await countWarehouses(),beforeWarehouses);
      assert.equal((await prisma.branch.findUniqueOrThrow({where:{id:branch}})).nameEn,'Synthetic branch');
      const genuineAudit=audit.recordRequired.bind(audit);
      let failedAction='CREATE';
      audit.recordRequired=async(entry,tx)=>{
        if(entry.entity==='branches' && entry.action===failedAction) throw new Error('synthetic branch audit failure');
        return genuineAudit(entry,tx);
      };
      try {
        assert.equal((await requestBranch('POST','/company/branches',branchBody,true)).status,500);
        assert.equal(await countBranches(),beforeBranches);
        assert.equal(await countWarehouses(),beforeWarehouses);
        failedAction='';
        const createdBranch=await requestBranch('POST','/company/branches',branchBody,true);
        assert.equal(createdBranch.status,201);
        const newBranch=await createdBranch.json();
        assert.equal(await countBranches(),beforeBranches+1);
        assert.equal(await countWarehouses(),beforeWarehouses+1);
        const branchAuditCount=()=>prisma.auditLog.count({where:{companyId:company,entity:'branches',entityId:newBranch.id}});
        assert.equal(await branchAuditCount(),1);
        failedAction='UPDATE';
        assert.equal((await requestBranch('PATCH',`/company/branches/${newBranch.id}`,{nameEn:'Changed'},true)).status,500);
        assert.equal((await prisma.branch.findUniqueOrThrow({where:{id:newBranch.id}})).nameEn,branchBody.nameEn);
        assert.equal(await branchAuditCount(),1);
        failedAction='';
        assert.equal((await requestBranch('PATCH',`/company/branches/${newBranch.id}`,{nameEn:'Changed'},true)).status,200);
        failedAction='DELETE';
        assert.equal((await requestBranch('DELETE',`/company/branches/${newBranch.id}`,undefined,true)).status,500);
        assert.equal((await prisma.branch.findUniqueOrThrow({where:{id:newBranch.id}})).deletedAt,null);
        assert.equal(await branchAuditCount(),2);
        failedAction='';
        assert.equal((await requestBranch('DELETE',`/company/branches/${newBranch.id}`,undefined,true)).status,200);
        assert.ok((await prisma.branch.findUniqueOrThrow({where:{id:newBranch.id}})).deletedAt);
        assert.equal(await branchAuditCount(),3);
      } finally {audit.recordRequired=genuineAudit;}
      console.log('PASS: branch mutation HTTP super-admin denial and required-audit rollback of branch and warehouse on real PostgreSQL; injected principal.');
    } finally { await companyHttp.close(); }
    console.log('PASS: real HTTP and PostgreSQL company/settings and scheduled-backup guards: delegated admin denied with audit, super admin allowed, audit failure fails closed. Schedule actions are stubbed and test-injected principal: JWT and license guards not tested.');
    // Competing UI permission edits start from the same snapshot. The role
    // lock and expected set permit exactly one and retain an atomic audit.
    const roles = new RolesService(prisma,audit);
    const grants = await Promise.all(['synthetic.read','synthetic.write','synthetic.export'].map(code =>
      prisma.permission.create({data:{code,nameEn:'Synthetic',nameAr:'تجريبي',module:'synthetic'}})));
    const role = await prisma.role.create({data:{companyId:company,code:'SYN-CAS',nameEn:'Synthetic role',nameAr:'دور تجريبي'}});
    await prisma.rolePermission.create({data:{roleId:role.id,permissionId:grants[0].id}});
    const roleRace = await Promise.allSettled([
      roles.setPermissions(company,user,role.id,['synthetic.read','synthetic.write'],[],true,['synthetic.read']),
      roles.setPermissions(company,user,role.id,['synthetic.read','synthetic.export'],[],true,['synthetic.read']),
    ]);
    assert.equal(roleRace.filter(x => x.status === 'fulfilled').length,1);
    assert.equal(roleRace.filter(x => x.status === 'rejected').length,1);
    assert.match(String(roleRace.find(x => x.status === 'rejected').reason?.message),/changed since they were loaded/);
    const roleCodes = async () => (await prisma.rolePermission.findMany({where:{roleId:role.id},include:{permission:true}})).map(x=>x.permission.code).sort();
    const successfulCodes = await roleCodes();
    assert.equal(successfulCodes.length,2);
    assert.equal(await prisma.auditLog.count({where:{entity:'roles',entityId:role.id,action:'role.permissions_set'}}),1);
    const roleAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (input,tx) => {
      if (input.action === 'role.permissions_set') throw new Error('injected role audit failure');
      return roleAudit(input,tx);
    };
    try {
      await assert.rejects(roles.setPermissions(company,user,role.id,['synthetic.read'],[],true,successfulCodes),/injected role audit failure/);
      assert.deepEqual(await roleCodes(),successfulCodes);
      assert.equal(await prisma.auditLog.count({where:{entity:'roles',entityId:role.id,action:'role.permissions_set'}}),1);
    } finally { audit.recordRequired = roleAudit; }
    console.log('PASS: real PostgreSQL serializes competing role grants and rolls back audit failure. Legacy callers without an expected set can still overwrite later changes.');
    const users = new UsersService(prisma,audit,{});
    const role2 = await prisma.role.create({data:{companyId:company,code:'SYN-CAS-2',nameEn:'Synthetic role 2',nameAr:'دور تجريبي ٢'}});
    const existingRoles = (await prisma.userRole.findMany({where:{userId:user,companyId:company},select:{roleId:true}})).map(x=>x.roleId).sort();
    assert.deepEqual(existingRoles,[]);
    const userRoleRace = await Promise.allSettled([
      users.update(company,user,user,{roleIds:[role.id],expectedRoleIds:existingRoles},[],true),
      users.update(company,user,user,{roleIds:[role2.id],expectedRoleIds:existingRoles},[],true),
    ]);
    assert.equal(userRoleRace.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(userRoleRace.filter(x=>x.status==='rejected').length,1);
    assert.match(String(userRoleRace.find(x=>x.status==='rejected').reason?.message),/User roles changed/);
    assert.equal(await prisma.userRole.count({where:{userId:user,companyId:company}}),1);
    const existingExtra = (await prisma.userPermission.findMany({where:{userId:user},include:{permission:true}})).map(x=>x.permission.code).sort();
    assert.deepEqual(existingExtra,[]);
    const userGrantRace = await Promise.allSettled([
      users.update(company,user,user,{extraPermissions:['synthetic.read'],expectedExtraPermissions:existingExtra},[],true),
      users.update(company,user,user,{extraPermissions:['synthetic.write'],expectedExtraPermissions:existingExtra},[],true),
    ]);
    assert.equal(userGrantRace.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(userGrantRace.filter(x=>x.status==='rejected').length,1);
    assert.match(String(userGrantRace.find(x=>x.status==='rejected').reason?.message),/User permissions changed/);
    assert.equal(await prisma.userPermission.count({where:{userId:user}}),1);
    const userSnapshot = await prisma.user.findUniqueOrThrow({where:{id:user}});
    const finalRoles = (await prisma.userRole.findMany({where:{userId:user,companyId:company},select:{roleId:true}})).map(x=>x.roleId).sort();
    const finalGrants = (await prisma.userPermission.findMany({where:{userId:user},include:{permission:true}})).map(x=>x.permission.code).sort();
    const userAuditCount = await prisma.auditLog.count({where:{companyId:company,entity:'users',entityId:user,action:'user.update'}});
    const realUserAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (entry,tx) => {
      if (entry.action==='user.update') throw new Error('synthetic user audit failure');
      return realUserAudit(entry,tx);
    };
    try {
      await assert.rejects(users.update(company,user,user,{fullNameEn:'Must roll back',roleIds:[],expectedRoleIds:finalRoles,
        extraPermissions:[],expectedExtraPermissions:finalGrants},[],true),/synthetic user audit failure/);
    } finally { audit.recordRequired = realUserAudit; }
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user}})).fullNameEn,userSnapshot.fullNameEn);
    assert.deepEqual((await prisma.userRole.findMany({where:{userId:user,companyId:company},select:{roleId:true}})).map(x=>x.roleId).sort(),finalRoles);
    assert.deepEqual((await prisma.userPermission.findMany({where:{userId:user},include:{permission:true}})).map(x=>x.permission.code).sort(),finalGrants);
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'users',entityId:user,action:'user.update'}}),userAuditCount);
    console.log('PASS: user update and role/grant changes roll back on required audit failure.');
    // Restore the synthetic user's empty grants so unrelated later fixtures
    // execute with the same inputs they had before this concurrency test.
    await prisma.userRole.deleteMany({where:{userId:user,companyId:company}});
    await prisma.userPermission.deleteMany({where:{userId:user}});
    console.log('PASS: real PostgreSQL serializes stale user role and direct-grant replacements; legacy clients remain compatible without a snapshot.');

    const costCenters = new CostCentersService(prisma, audit);
    const numbers = new DocumentNumberService();
    const periods = new FiscalPeriodsService(prisma, audit);
    const ledger = new StockLedgerService();
    const service = new StockDocumentsService(prisma, numbers,
      new PostingService(numbers, periods, costCenters), new AccountMapService(), audit,
      new CompanySettingsService(prisma, audit), new WarehouseService(prisma, audit), costCenters, ledger);
    const date = '2026-10-28';
    // Date clear semantics on the real service and isolated PostgreSQL. This
    // centre is separate from the centre used by stock posting below.
    const datesCenter = await costCenters.create(company,user,{
      code:'SYN-DATES',nameEn:'Dates',nameAr:'تواريخ',type:'DEPARTMENT',
      startDate:'2026-01-01',endDate:'2026-12-31'});
    let dateResult = await costCenters.update(company,user,datesCenter.id,{endDate:null});
    assert.equal(dateResult.startDate,'2026-01-01'); assert.equal(dateResult.endDate,null);
    dateResult = await costCenters.update(company,user,datesCenter.id,{endDate:'2026-12-31'});
    assert.equal(dateResult.endDate,'2026-12-31');
    dateResult = await costCenters.update(company,user,datesCenter.id,{startDate:'',endDate:null});
    assert.equal(dateResult.startDate,null); assert.equal(dateResult.endDate,null);
    await costCenters.update(company,user,datesCenter.id,{startDate:'2026-01-01',endDate:'2026-12-31'});
    await assert.rejects(costCenters.update(company,user,datesCenter.id,{startDate:'2027-01-01'}),/endDate cannot be before startDate/);
    const persistedDates = await prisma.costCenter.findUniqueOrThrow({where:{id:datesCenter.id}});
    assert.equal(persistedDates.startDate.toISOString().slice(0,10),'2026-01-01');
    assert.equal(persistedDates.endDate.toISOString().slice(0,10),'2026-12-31');
    console.log('PASS: real PostgreSQL cost center dates retain omitted values and clear explicit null/empty.');
    // Required audit writes are in the same transaction as each budget change.
    const budgets = new BudgetsService(prisma,audit);
    const budgetInput = {costCenterId:datesCenter.id,accountId:difference,
      periodStart:'2025-01-01',periodEnd:'2025-12-31',amount:'1000'};
    const originalBudgetAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (input,tx) => {
      if (input.entity === 'budgets') throw new Error('injected budget audit failure');
      return originalBudgetAudit(input,tx);
    };
    try {
      await assert.rejects(budgets.create(company,user,budgetInput),/injected budget audit failure/);
      assert.equal(await prisma.budget.count({where:{companyId:company,costCenterId:datesCenter.id}}),0);
    } finally { audit.recordRequired = originalBudgetAudit; }
    const budget = await budgets.create(company,user,budgetInput);
    audit.recordRequired = async (input,tx) => {
      if (input.entity === 'budgets') throw new Error('injected budget audit failure');
      return originalBudgetAudit(input,tx);
    };
    try {
      await assert.rejects(budgets.update(company,user,budget.id,{amount:'2000'}),/injected budget audit failure/);
      await assert.rejects(budgets.retire(company,user,budget.id),/injected budget audit failure/);
      const unchanged = await budgets.findOne(company,budget.id);
      assert.equal(unchanged.amount,'1000.0000'); assert.equal(unchanged.retired,false);
    } finally { audit.recordRequired = originalBudgetAudit; }
    assert.equal((await budgets.update(company,user,budget.id,{amount:'2000'})).amount,'2000.0000');
    assert.equal((await budgets.retire(company,user,budget.id)).retired,true);
    const budgetAudit = await prisma.auditLog.findMany({where:{companyId:company,entity:'budgets',entityId:budget.id}});
    assert.deepEqual(budgetAudit.map(x => x.action).sort(),['CREATE','DELETE','UPDATE']);
    console.log('PASS: real PostgreSQL budget create/update/retire roll back on audit failure.');
    // Real chart operations, not an HTTP or Flutter test. The fixture uses
    // unique synthetic codes and keeps historical journal rows untouched.
    const chart = new ChartOfAccountsService(prisma, audit);
    await require('./verify-account-posting-races.cjs')({prisma,chart,posting:service.posting,company,branch,user});
    const stockReports = new StockService(prisma);
    const statements = new FinancialStatementsService(prisma);
    const root = await chart.create(company, user, { code:'SYN-ROOT', nameEn:'Synthetic root',
      nameAr:'حساب رئيسي تجريبي', type:'ASSET', isPostable:false });
    const child = await chart.create(company, user, { code:'SYN-CHILD', nameEn:'Synthetic child',
      nameAr:'حساب فرعي تجريبي', type:'ASSET', parentId:root.id, isPostable:true });
    assert.equal(child.parentId,root.id);
    await assert.rejects(chart.create(company,user,{code:'SYN-CHILD',nameEn:'Duplicate',nameAr:'مكرر',type:'ASSET'}), /already used/i);
    await assert.rejects(chart.update(company,user,root.id,{isActive:false}), /subaccounts/i);
    assert.equal((await chart.update(company,user,child.id,{isActive:false})).isActive,false);
    assert.equal((await chart.update(company,user,root.id,{isActive:false})).isActive,false);
    await assert.rejects(chart.update(company,user,child.id,{isActive:true}), /parent account is inactive/i);
    assert.equal((await prisma.account.findUniqueOrThrow({where:{id:child.id}})).isActive,false);
    assert.equal((await chart.update(company,user,root.id,{isActive:true})).isActive,true);
    assert.equal((await chart.update(company,user,child.id,{isActive:true})).isActive,true);
    const hierarchy = await sql.query('SELECT "parentId", "isActive" FROM accounts WHERE id=$1', [child.id]);
    assert.equal(hierarchy.rows[0].parentId, root.id);
    assert.equal(hierarchy.rows[0].isActive, true);
    // Audit is required in the same transaction as all chart mutations.
    // A failed audit must roll back both a newly created child and any parent
    // demotion, as well as account edits and soft deletion.
    const leaf = await chart.create(company,user,{code:'SYN-AUDIT',nameEn:'Audit leaf',nameAr:'فرعي',type:'ASSET',isPostable:true});
    const chartAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (input,tx) => {
      if (input.entity === 'accounts') throw new Error('injected chart audit failure');
      return chartAudit(input,tx);
    };
    try {
      await assert.rejects(chart.create(company,user,{code:'SYN-ROLLBACK',nameEn:'Rollback',nameAr:'تراجع',type:'ASSET',parentId:leaf.id}),/injected chart audit failure/);
      assert.equal(await prisma.account.count({where:{companyId:company,code:'SYN-ROLLBACK'}}),0);
      assert.equal((await prisma.account.findUniqueOrThrow({where:{id:leaf.id}})).isPostable,true);
      await assert.rejects(chart.update(company,user,leaf.id,{nameEn:'Changed'}),/injected chart audit failure/);
      assert.equal((await prisma.account.findUniqueOrThrow({where:{id:leaf.id}})).nameEn,'Audit leaf');
      await assert.rejects(chart.remove(company,user,leaf.id),/injected chart audit failure/);
      assert.equal((await prisma.account.findUniqueOrThrow({where:{id:leaf.id}})).deletedAt,null);
    } finally { audit.recordRequired = chartAudit; }
    const accountAudit = await prisma.auditLog.count({where:{companyId:company,entity:'accounts',entityId:leaf.id,action:'CREATE'}});
    assert.equal(accountAudit,1);
    console.log('PASS: real PostgreSQL + Prisma chart relationship, duplicate, activation and atomic audit rollback.');
    // Account moves are only allowed for subtrees with no journal lines.
    // Reports currently group using the live tree, so moving existing history
    // would retroactively change historical account subtotals.
    const destination = await chart.create(company,user,{code:'SYN-TREE-DEST',nameEn:'Destination',nameAr:'وجهة',type:'ASSET',isPostable:false});
    const movable = await chart.create(company,user,{code:'SYN-TREE-FREE',nameEn:'Movable',nameAr:'قابل للنقل',type:'ASSET',parentId:root.id});
    assert.equal((await chart.update(company,user,movable.id,{parentId:null,expectedParentId:root.id})).parentId,null);
    await assert.rejects(chart.update(company,user,movable.id,{parentId:destination.id,expectedParentId:root.id}),/parent changed/);
    assert.equal((await chart.update(company,user,movable.id,{parentId:destination.id,expectedParentId:null})).parentId,destination.id);
    audit.recordRequired = async (input,tx) => {
      if (input.entity === 'accounts' && input.entityId === movable.id) throw new Error('injected move audit failure');
      return chartAudit(input,tx);
    };
    try {
      await assert.rejects(chart.update(company,user,movable.id,{parentId:null,expectedParentId:destination.id}),/injected move audit failure/);
      assert.equal((await prisma.account.findUniqueOrThrow({where:{id:movable.id}})).parentId,destination.id);
    } finally { audit.recordRequired = chartAudit; }
    // Exercise the real controller, validation pipe, service and PostgreSQL
    // over loopback HTTP. The synthetic principal is injected by test-only
    // middleware: JWT and licensing remain outside this fixture.
    class ChartHttpFixtureModule {}
    Module({controllers:[ChartOfAccountsController],providers:[{provide:ChartOfAccountsService,useValue:chart}]})(ChartHttpFixtureModule);
    const httpApp = await NestFactory.create(ChartHttpFixtureModule,{logger:false});
    try {
      httpApp.use((req,_res,next)=>{req.user={companyId:company,userId:user,branchId:branch,isSuperAdmin:false,
        permissions:req.headers['x-allowed']==='yes'?['accounting.accounts.update']:[]};next();});
      httpApp.useGlobalGuards(new PermissionsGuard(new Reflector()));
      httpApp.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      httpApp.useGlobalFilters(new ProblemDetailsFilter());
      await httpApp.listen(0,'127.0.0.1');
      const address=httpApp.getHttpServer().address();
      const endpoint=`http://127.0.0.1:${address.port}/accounting/chart-of-accounts/${movable.id}`;
      const patch=(body,allowed=true)=>fetch(endpoint,{method:'PATCH',headers:{'content-type':'application/json','x-allowed':allowed?'yes':'no'},body:JSON.stringify(body)});
      assert.equal((await patch({parentId:null,expectedParentId:destination.id},false)).status,403);
      assert.equal((await prisma.account.findUniqueOrThrow({where:{id:movable.id}})).parentId,destination.id);
      assert.equal((await patch({parentId:null,expectedParentId:'not-a-uuid'})).status,400);
      assert.equal((await patch({parentId:null,expectedParentId:root.id})).status,409);
      const detached=await patch({parentId:null,expectedParentId:destination.id});
      assert.equal(detached.status,200);
      assert.equal((await detached.json()).parentId,null);
      assert.equal((await prisma.account.findUniqueOrThrow({where:{id:movable.id}})).parentId,null);
    } finally { await httpApp.close(); }
    console.log('PASS: chart PATCH over real HTTP with permission guard, DTO validation, service and PostgreSQL; injected principal, no JWT or Flutter.');
    if (process.env.KAYAN_RUN_FLUTTER_PG_TESTS === 'true') {
      await require('./verify-chart-flutter-http-pg.cjs')({prisma,chart,company,user,branch});
    }
    const usedGroup = await chart.create(company,user,{code:'SYN-HIST-GROUP',nameEn:'History group',nameAr:'مجموعة تاريخية',type:'ASSET',parentId:root.id,isPostable:false});
    const usedLeaf = await chart.create(company,user,{code:'SYN-HIST-LEAF',nameEn:'History leaf',nameAr:'حساب تاريخي',type:'ASSET',parentId:usedGroup.id,isPostable:true});
    await prisma.journalEntry.create({data:{companyId:company,branchId:branch,entryNumber:'SYN-TREE-HISTORY',
      entryDate:new Date('2090-01-10T00:00:00Z'),status:'POSTED',totalDebit:11,totalCredit:11,
      lines:{create:[{lineNumber:1,accountId:usedLeaf.id,debit:11,credit:0},
        {lineNumber:2,accountId:inventory,debit:0,credit:11}]}}});
    const reports = new ReportsService(prisma);
    const reportBefore = await reports.trialBalance(company,{from:'2090-01-01',to:'2090-12-31'});
    assert.equal(reportBefore.groups.find(x=>x.accountId===root.id).debit,'11.0000');
    await assert.rejects(chart.update(company,user,usedGroup.id,{parentId:destination.id,expectedParentId:root.id}),/historical reports/);
    const reportAfter = await reports.trialBalance(company,{from:'2090-01-01',to:'2090-12-31'});
    assert.deepEqual(reportAfter.groups,reportBefore.groups);
    assert.deepEqual(reportAfter.totals,reportBefore.totals);
    assert.equal((await prisma.account.findUniqueOrThrow({where:{id:usedGroup.id}})).parentId,root.id);
    const a = await chart.create(company,user,{code:'SYN-TREE-A',nameEn:'A',nameAr:'أ',type:'ASSET',isPostable:false});
    const b = await chart.create(company,user,{code:'SYN-TREE-B',nameEn:'B',nameAr:'ب',type:'ASSET',isPostable:false});
    const treeRace = await Promise.allSettled([
      chart.update(company,user,a.id,{parentId:b.id,expectedParentId:null}),
      chart.update(company,user,b.id,{parentId:a.id,expectedParentId:null}),
    ]);
    assert.equal(treeRace.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(treeRace.filter(x=>x.status==='rejected').length,1);
    const aAfter=await prisma.account.findUniqueOrThrow({where:{id:a.id}});
    const bAfter=await prisma.account.findUniqueOrThrow({where:{id:b.id}});
    assert(!(aAfter.parentId===b.id && bAfter.parentId===a.id));

    // A journal insert obtains PostgreSQL's FK key-share lock on its account.
    // The move must wait, then observe the newly committed line and refuse.
    const raceGroup = await chart.create(company,user,{code:'SYN-TREE-LOCK',nameEn:'Race group',nameAr:'مجموعة سباق',type:'ASSET',parentId:root.id,isPostable:false});
    const raceLeaf = await chart.create(company,user,{code:'SYN-TREE-LOCK-L',nameEn:'Race leaf',nameAr:'فرع سباق',type:'ASSET',parentId:raceGroup.id});
    const journalWriter = new Client({connectionString:url.toString()});
    await journalWriter.connect();
    try {
      await journalWriter.query('BEGIN');
      await journalWriter.query(`INSERT INTO journal_entries (id,"companyId","branchId","entryNumber","entryDate",status,"totalDebit","totalCredit","updatedAt")
        VALUES ('70000000-0000-4000-8000-000000000080',$1,$2,'SYN-TREE-RACE','2091-01-01','DRAFT',0,0,now())`,[company,branch]);
      await journalWriter.query(`INSERT INTO journal_lines (id,"journalEntryId","lineNumber","accountId",debit,credit)
        VALUES ('70000000-0000-4000-8000-000000000081','70000000-0000-4000-8000-000000000080',1,$1,1,0)`,[raceLeaf.id]);
      const observed = chart.update(company,user,raceGroup.id,{parentId:null,expectedParentId:root.id})
        .then(value=>({value}),error=>({error}));
      let sawWait=false;
      for (let attempt=0;attempt<30;attempt++) {
        const waiting=await sql.query(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE wait_event_type='Lock' AND query LIKE '%WITH RECURSIVE subtree%' AND query LIKE '%FOR UPDATE%' AND pid<>pg_backend_pid()) AS waiting`);
        if (waiting.rows[0].waiting) {sawWait=true;break;}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(sawWait,true,'account move must wait for the in-flight journal FK');
      await journalWriter.query('COMMIT');
      const outcome=await observed;
      assert.match(String(outcome.error?.message),/historical reports/);
      assert.equal((await prisma.account.findUniqueOrThrow({where:{id:raceGroup.id}})).parentId,root.id);
    } finally {
      await journalWriter.query('ROLLBACK').catch(()=>{});
      await journalWriter.end();
    }
    console.log('PASS: real PostgreSQL account detach/move, stale snapshots, audit rollback, preserved trial balance, opposing moves and concurrent journal insert. Not HTTP, Flutter or direct SQL protection.');

    // Force two manual-journal requests to finish their initial reads before
    // either can claim the observed status. Test actual row state and audit.
    const journalSettings = new CompanySettingsService(prisma,audit);
    const createJournal = async (number,status='DRAFT') => prisma.journalEntry.create({data:{
      companyId:company,branchId:branch,entryNumber:number,entryDate:new Date('2190-01-01T00:00:00Z'),
      status,totalDebit:'10',totalCredit:'10',createdBy:user,
      lines:{create:[{lineNumber:1,accountId:usedLeaf.id,debit:'10',credit:'0'},
        {lineNumber:2,accountId:inventory,debit:'0',credit:'10'}]},
    }});
    for (const [number,initial,first,second] of [
      ['SYN-JR-POST-CANCEL','DRAFT','post','cancel'],
      ['SYN-JR-SUBMIT-CANCEL','DRAFT','submitForApproval','cancel'],
      ['SYN-JR-APPROVE-CANCEL','PENDING_APPROVAL','approve','cancel'],
      ['SYN-JR-APPROVED-POST-CANCEL','APPROVED','post','cancel'],
      ['SYN-JR-POST-POST','DRAFT','post','post'],
    ]) {
      const draft=await createJournal(number,initial);
      let release; const gate = new Promise(resolve=>{release=resolve;});
      let reads=0;
      const model = new Proxy(prisma.journalEntry,{get(target,key) {
        const original=target[key];
        if (key==='findFirst') return async (...args)=>{
          const value=await original.apply(target,args);
          if (args[0]?.where?.id===draft.id) {
            reads++; if(reads===2) release(); await gate;
          }
          return value;
        };
        return typeof original==='function' ? original.bind(target) : original;
      }});
      const wrapped = new Proxy(prisma,{get(target,key) {
        if (key==='journalEntry') return model;
        const value=target[key]; return typeof value==='function' ? value.bind(target) : value;
      }});
      const journals = new JournalEntriesService(wrapped,numbers,audit,periods,journalSettings,costCenters);
      const result=await Promise.allSettled([journals[first](company,user,draft.id),journals[second](company,user,draft.id)]);
      assert.equal(reads,2,number);
      assert.equal(result.filter(x=>x.status==='fulfilled').length,1,number);
      const failure=result.find(x=>x.status==='rejected');
      assert.equal(failure.reason.getStatus(),409,number);
      const winner=result.find(x=>x.status==='fulfilled').value;
      const saved=await prisma.journalEntry.findUniqueOrThrow({where:{id:draft.id},include:{lines:true}});
      assert.equal(saved.status.toLowerCase(),winner.status,number);
      assert.equal(saved.lines.length,2,number);
      assert.equal(saved.totalDebit.toFixed(4),'10.0000',number);
      assert.equal(saved.totalCredit.toFixed(4),'10.0000',number);
      const logs=await prisma.auditLog.findMany({where:{companyId:company,entity:'journal_entries',entityId:draft.id}});
      assert.equal(logs.length,1,number);
      assert.equal(logs[0].action,({posted:'POST',cancelled:'CANCEL',pending_approval:'SUBMIT',approved:'APPROVE'})[winner.status],number);
    }
    const manualJournal = new JournalEntriesService(prisma,numbers,audit,periods,journalSettings,costCenters);
    const rollbackJournal = await createJournal('SYN-JR-AUDIT');
    const journalAudit=audit.recordRequired.bind(audit);
    audit.recordRequired=async (input,tx)=>{
      if(input.entity==='journal_entries' && input.entityId===rollbackJournal.id) throw new Error('synthetic journal audit failure');
      return journalAudit(input,tx);
    };
    try {
      await assert.rejects(manualJournal.post(company,user,rollbackJournal.id),/synthetic journal audit failure/);
      await assert.rejects(manualJournal.cancel(company,user,rollbackJournal.id),/synthetic journal audit failure/);
      const saved=await prisma.journalEntry.findUniqueOrThrow({where:{id:rollbackJournal.id}});
      assert.equal(saved.status,'DRAFT'); assert.equal(saved.postedAt,null); assert.equal(saved.cancelledAt,null);
      assert.equal(await prisma.auditLog.count({where:{entity:'journal_entries',entityId:rollbackJournal.id}}),0);
    } finally {audit.recordRequired=journalAudit;}

    // Balanced headers cannot hide a different sum in the journal lines.
    const corrupt=await createJournal('SYN-JR-CORRUPT');
    const corruptLine=await prisma.journalLine.findFirstOrThrow({where:{journalEntryId:corrupt.id,lineNumber:2}});
    await prisma.journalLine.update({where:{id:corruptLine.id},data:{credit:'7'}});
    await assert.rejects(manualJournal.post(company,user,corrupt.id),/lines do not balance/i);
    assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:corrupt.id}})).status,'DRAFT');
    assert.equal(await prisma.auditLog.count({where:{entity:'journal_entries',entityId:corrupt.id,action:'POST'}}),0);

    // Deactivate after the first read but before the transaction. The locked
    // revalidation must reject and roll back the tentative POSTED transition.
    const staleAccount=await createJournal('SYN-JR-STALE-ACCOUNT');
    let reached, resume;
    const reachedPromise=new Promise(resolve=>{reached=resolve;});
    const resumePromise=new Promise(resolve=>{resume=resolve;});
    const delayedSettings={get:async (...args)=>{
      const policy=await journalSettings.get(...args); reached(); await resumePromise; return policy;
    }};
    const staleService=new JournalEntriesService(prisma,numbers,audit,periods,delayedSettings,costCenters);
    const staleResult=staleService.post(company,user,staleAccount.id).then(value=>({value}),error=>({error}));
    await Promise.race([reachedPromise,staleResult.then(result=>{
      throw result.error ?? new Error('posting returned before the policy barrier');
    })]);
    try { await chart.update(company,user,usedLeaf.id,{isActive:false}); }
    finally { resume(); }
    const staleOutcome=await staleResult;
    assert.match(staleOutcome.error.message,/accounts are unavailable/i);
    assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:staleAccount.id}})).status,'DRAFT');
    assert.equal(await prisma.auditLog.count({where:{entity:'journal_entries',entityId:staleAccount.id,action:'POST'}}),0);
    await chart.update(company,user,usedLeaf.id,{isActive:true});

    // Hold the account share lock during posting; a competing deactivation
    // must wait until posting commits, then it may safely apply afterwards.
    const lockJournal=await createJournal('SYN-JR-ACCOUNT-LOCK');
    let locked, unlock; const lockedPromise=new Promise(resolve=>{locked=resolve;});
    const unlockPromise=new Promise(resolve=>{unlock=resolve;});
    const lockedPrisma=new Proxy(prisma,{get(target,key){
      if(key==='$transaction') return callback=>target.$transaction(async tx=>callback(new Proxy(tx,{get(t,k){
        const value=t[k];
        if(k==='$queryRaw') return async (...args)=>{const result=await value.apply(t,args);locked();await unlockPromise;return result;};
        return typeof value==='function'?value.bind(t):value;
      }})));
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    const lockService=new JournalEntriesService(lockedPrisma,numbers,audit,periods,journalSettings,costCenters);
    const lockPosting=lockService.post(company,user,lockJournal.id).then(value=>({value}),error=>({error}));
    await Promise.race([lockedPromise,lockPosting.then(result=>{
      throw result.error ?? new Error('posting returned before locking accounts');
    })]);
    const deactivate=chart.update(company,user,usedLeaf.id,{isActive:false}).then(value=>({value}),error=>({error}));
    let accountWait=false;
    try {
      for(let attempt=0;attempt<30;attempt++) {
        const waiting=await sql.query(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
          AND query ILIKE '%UPDATE%accounts%' AND pid<>pg_backend_pid()) AS waiting`);
        if(waiting.rows[0].waiting){accountWait=true;break;}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(accountWait,true,'deactivation must wait for posting account lock');
    } finally {unlock();}
    const postedResult=await lockPosting; if(postedResult.error) throw postedResult.error;
    const deactivatedResult=await deactivate; if(deactivatedResult.error) throw deactivatedResult.error;
    assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:lockJournal.id}})).status,'POSTED');
    assert.equal((await prisma.account.findUniqueOrThrow({where:{id:usedLeaf.id}})).isActive,false);
    assert.equal(await prisma.auditLog.count({where:{entity:'journal_entries',entityId:lockJournal.id,action:'POST'}}),1);
    await chart.update(company,user,usedLeaf.id,{isActive:true});
    console.log('PASS: journal lines/header mismatch rejected, stale account refused, and deactivation waits for posting account locks on real PG.');

    // Manual entry number allocation, creation and audit share a transaction;
    // reversal claim, mirror entry, number and audit must do the same.
    const sequence=async()=>prisma.documentSequence.findUnique({where:{companyId_key:{companyId:company,key:'JOURNAL'}}});
    const createDto={entryDate:'2190-01-01',description:'synthetic',lines:[
      {accountId:usedLeaf.id,debit:'10'}, {accountId:inventory,credit:'10'},
    ]};
    const beforeCreateCount=await prisma.journalEntry.count({where:{companyId:company}});
    const beforeCreateSequence=await sequence();
    const requiredAudit=audit.recordRequired.bind(audit);
    audit.recordRequired=async (input,tx)=>{
      if(input.entity==='journal_entries' && input.action==='CREATE') throw new Error('synthetic creation audit failure');
      return requiredAudit(input,tx);
    };
    try {await assert.rejects(manualJournal.create(company,branch,user,createDto),/synthetic creation audit failure/);}
    finally {audit.recordRequired=requiredAudit;}
    assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),beforeCreateCount);
    assert.equal((await sequence())?.nextValue,beforeCreateSequence?.nextValue);
    const createdManual=await manualJournal.create(company,branch,user,createDto);
    assert.equal(createdManual.status,'draft');
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'journal_entries',entityId:createdManual.id,action:'CREATE'}}),1);
    const reversalCount=await prisma.journalEntry.count({where:{companyId:company}});
    const beforeReverseSequence=await sequence();
    audit.recordRequired=async (input,tx)=>{
      if(input.entity==='journal_entries' && input.entityId===lockJournal.id && input.action==='REVERSE') throw new Error('synthetic reversal audit failure');
      return requiredAudit(input,tx);
    };
    try {await assert.rejects(manualJournal.reverse(company,user,lockJournal.id),/synthetic reversal audit failure/);}
    finally {audit.recordRequired=requiredAudit;}
    assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:lockJournal.id}})).status,'POSTED');
    assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),reversalCount);
    assert.equal((await sequence())?.nextValue,beforeReverseSequence?.nextValue);
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'journal_entries',entityId:lockJournal.id,action:'REVERSE'}}),0);
    const reversed=await manualJournal.reverse(company,user,lockJournal.id);
    assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:lockJournal.id}})).status,'REVERSED');
    assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:reversed.id}})).status,'POSTED');
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'journal_entries',entityId:lockJournal.id,action:'REVERSE'}}),1);
    console.log('PASS: real PG manual journal creation/reversal required-audit failure rolls back rows, status and document number.');

    // Real HTTP + DTO/controller/permission guard/service/PG. Identity is
    // injected and does not establish JWT or licensing enforcement.
    class JournalHttpModule {}
    Module({controllers:[JournalEntriesController],providers:[{provide:JournalEntriesService,useValue:manualJournal}]})(JournalHttpModule);
    const journalHttp=await NestFactory.create(JournalHttpModule,{logger:false});
    try {
      journalHttp.use((req,_res,next)=>{req.user={userId:user,companyId:company,branchId:branch,username:'synthetic',isSuperAdmin:false,
        permissions:req.headers['x-allowed']==='yes'?['accounting.journal.create']:[]};next();});
      journalHttp.useGlobalGuards(new PermissionsGuard(new Reflector()));
      journalHttp.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      journalHttp.useGlobalFilters(new ProblemDetailsFilter());
      await journalHttp.listen(0,'127.0.0.1');
      const base=`http://127.0.0.1:${journalHttp.getHttpServer().address().port}/accounting/journal-entries/${rollbackJournal.id}/cancel`;
      const cancel=allowed=>fetch(base,{method:'POST',headers:{'content-type':'application/json','x-allowed':allowed?'yes':'no'},body:JSON.stringify({reason:'synthetic'})});
      assert.equal((await cancel(false)).status,403);
      assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:rollbackJournal.id}})).status,'DRAFT');
      const response=await cancel(true); assert.equal(response.status,201);
      assert.equal((await response.json()).status,'cancelled');
      assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:rollbackJournal.id}})).status,'CANCELLED');
      assert.equal(await prisma.auditLog.count({where:{entity:'journal_entries',entityId:rollbackJournal.id,action:'CANCEL'}}),1);
    } finally {await journalHttp.close();}
    console.log('PASS: journal transitions: forced stale-read races, required-audit rollback and HTTP permission denial with real PG; identity injected, no JWT or Flutter.');



    // Closing owns the same PostgreSQL period row locked by the posting
    // triggers. This uses a disposable future period and synthetic accounts;
    // it is not a test of every draft creation path or installed UI.
    const yearClose = new YearEndCloseService(prisma,
      new PostingService(numbers,periods,costCenters), new AccountMapService(), audit);
    const makePeriod = async (year) => prisma.fiscalPeriod.create({data:{
      companyId:company,code:`SYN-${year}`,nameEn:'Synthetic year',nameAr:'سنة تجريبية',
      startDate:new Date(`${year}-01-01T00:00:00Z`),endDate:new Date(`${year}-12-31T00:00:00Z`),
    }});
    const emptyYear = await makePeriod(2200);
    const closeAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (input,tx) => {
      if (input.action === 'fiscal_year.close_empty') throw new Error('injected year audit failure');
      return closeAudit(input,tx);
    };
    try {
      await assert.rejects(yearClose.close(company,user,emptyYear.id),/injected year audit failure/);
      assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:emptyYear.id}})).status,'OPEN');
    } finally { audit.recordRequired = closeAudit; }
    const concurrentClose = await Promise.allSettled([
      yearClose.close(company,user,emptyYear.id), yearClose.close(company,user,emptyYear.id),
    ]);
    assert.equal(concurrentClose.filter(x => x.status === 'fulfilled').length,1);
    assert.equal(concurrentClose.filter(x => x.status === 'rejected').length,1);
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'fiscal_periods',entityId:emptyYear.id,action:'fiscal_year.close_empty'}}),1);

    const revenueAccount = await chart.create(company,user,{code:'SYN-REV',nameEn:'Revenue',nameAr:'إيراد',type:'REVENUE',isPostable:true});
    const existingRetained = await prisma.account.findUnique({where:{companyId_code:{companyId:company,code:'3102'}}});
    if (!existingRetained) {
      await chart.create(company,user,{code:'3102',nameEn:'Retained earnings',nameAr:'أرباح مبقاة',type:'EQUITY',isPostable:true});
    } else {
      assert.equal(existingRetained.deletedAt,null);
      assert.equal(existingRetained.isActive,true);
      assert.equal(existingRetained.isPostable,true);
    }
    const postYear = await makePeriod(2201);
    const poster = new Client({connectionString:url.toString()});
    await poster.connect();
    let pendingClose;
    try {
      await poster.query('BEGIN');
      // The production DB trigger locks the period until this transaction
      // commits, as a posting that has already started does in production.
      const ledger = await poster.query(`INSERT INTO journal_entries
        (id,"companyId","branchId","entryNumber","entryDate",status,"totalDebit","totalCredit","updatedAt")
        VALUES ('70000000-0000-4000-8000-000000000090',$1,$2,'SYN-PERIOD-POST','2201-05-01','POSTED',50,50,now()) RETURNING id`,[company,branch]);
      await poster.query(`INSERT INTO journal_lines
        (id,"journalEntryId","lineNumber","accountId",debit,credit)
        VALUES ('70000000-0000-4000-8000-000000000091',$1,1,$2,50,0),
               ('70000000-0000-4000-8000-000000000092',$1,2,$3,0,50)`,[ledger.rows[0].id,inventory,revenueAccount.id]);
      pendingClose = yearClose.close(company,user,postYear.id);
      // Attach a rejection observer immediately and prove it reached the DB
      // lock before letting the posting commit; no database values are logged.
      const observedClose = pendingClose.then(value => ({value}),error => ({error}));
      let sawWait = false;
      for (let attempt=0; attempt<30; attempt++) {
        const waiting = await sql.query(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
           WHERE wait_event_type='Lock' AND query LIKE '%FROM fiscal_periods%'
             AND query LIKE '%FOR UPDATE%' AND pid <> pg_backend_pid()
        ) AS waiting`);
        if (waiting.rows[0].waiting) { sawWait = true; break; }
        await new Promise(resolve => setTimeout(resolve,50));
      }
      assert.equal(sawWait,true,'close must wait for the posting period lock');
      await poster.query('COMMIT');
      const settled = await observedClose;
      if (settled.error) throw settled.error;
      assert.equal(settled.value.totals.revenue,'50.0000');
      assert.equal(settled.value.totals.result,'50.0000');
      assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:postYear.id}})).status,'CLOSED');
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,sourceType:'YEAR_END_CLOSE',sourceId:postYear.id}}),1);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'fiscal_periods',entityId:postYear.id,action:'fiscal_year.close'}}),1);
      await assert.rejects(prisma.journalEntry.create({data:{companyId:company,branchId:branch,
        entryNumber:'SYN-LATE',entryDate:new Date('2201-06-01T00:00:00Z'),status:'POSTED',totalDebit:1,totalCredit:1}}));
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,entryNumber:'SYN-LATE'}}),0);
    } finally {
      try { await poster.query('ROLLBACK'); } catch { /* already committed or connection closed */ }
      await poster.end();
      if (pendingClose) await pendingClose.catch(() => {});
    }
    const rollbackYear = await makePeriod(2202);
    await prisma.journalEntry.create({data:{companyId:company,branchId:branch,
      entryNumber:'SYN-AUDIT-POST',entryDate:new Date('2202-05-01T00:00:00Z'),
      status:'POSTED',totalDebit:20,totalCredit:20,lines:{create:[
        {lineNumber:1,accountId:inventory,debit:20,credit:0},
        {lineNumber:2,accountId:revenueAccount.id,debit:0,credit:20},
      ]}}});
    audit.recordRequired = async (input,tx) => {
      if (input.action === 'fiscal_year.close') throw new Error('injected year posting audit failure');
      return closeAudit(input,tx);
    };
    try {
      await assert.rejects(yearClose.close(company,user,rollbackYear.id),/injected year posting audit failure/);
      assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:rollbackYear.id}})).status,'OPEN');
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,sourceType:'YEAR_END_CLOSE',sourceId:rollbackYear.id}}),0);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'fiscal_periods',entityId:rollbackYear.id,action:'fiscal_year.close'}}),0);
    } finally { audit.recordRequired = closeAudit; }
    // A period with a posted entry cannot move that entry across its boundary,
    // although a name-only correction remains possible.
    await assert.rejects(periods.update(company,user,rollbackYear.id,{endDate:'2202-04-30'}),/posted history/);
    assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:rollbackYear.id}})).endDate.toISOString().slice(0,10),'2202-12-31');
    assert.equal((await periods.update(company,user,rollbackYear.id,{nameEn:'Reviewed year'})).nameEn,'Reviewed year');
    console.log('PASS: real PostgreSQL serializes concurrent closes and posting before close; audit failure rolls back empty and nonempty closes. Draft creation races remain outside this test.');
    // Application-mediated create/update ranges serialize per company. A
    // database-wide exclusion constraint is not added to an existing migration.
    const periodDto = (code,startDate,endDate) => ({code,nameEn:'Synthetic period',nameAr:'فترة تجريبية',startDate,endDate});
    const overlapCreate = await Promise.allSettled([
      periods.create(company,user,periodDto('SYN-RACE-A','2300-01-01','2300-12-31')),
      periods.create(company,user,periodDto('SYN-RACE-B','2300-01-01','2300-12-31')),
    ]);
    assert.equal(overlapCreate.filter(x => x.status === 'fulfilled').length,1);
    assert.equal(overlapCreate.filter(x => x.status === 'rejected').length,1);
    const racePeriod = overlapCreate.find(x => x.status === 'fulfilled').value;
    const adjacent = await periods.create(company,user,periodDto('SYN-NEXT','2301-01-01','2301-12-31'));
    await assert.rejects(periods.update(company,user,racePeriod.id,{endDate:'2301-01-01'}),/overlaps/);
    assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:racePeriod.id}})).endDate.toISOString().slice(0,10),'2300-12-31');

    const periodAudit = audit.recordRequired.bind(audit);
    audit.recordRequired = async (input,tx) => {
      if (input.action === 'fiscal_period.create' || input.action === 'fiscal_period.update' || input.action === 'fiscal_period.close') {
        throw new Error('injected fiscal period audit failure');
      }
      return periodAudit(input,tx);
    };
    try {
      await assert.rejects(periods.create(company,user,periodDto('SYN-FAIL','2302-01-01','2302-12-31')),/injected fiscal period audit failure/);
      assert.equal(await prisma.fiscalPeriod.count({where:{companyId:company,code:'SYN-FAIL'}}),0);
      await assert.rejects(periods.update(company,user,adjacent.id,{nameEn:'Changed'}),/injected fiscal period audit failure/);
      assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:adjacent.id}})).nameEn,'Synthetic period');
      await assert.rejects(periods.close(company,user,adjacent.id),/injected fiscal period audit failure/);
      assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:adjacent.id}})).status,'OPEN');
    } finally { audit.recordRequired = periodAudit; }
    const closeBoth = await Promise.allSettled([
      periods.close(company,user,adjacent.id), yearClose.close(company,user,adjacent.id),
    ]);
    assert.equal(closeBoth.filter(x => x.status === 'fulfilled').length,1);
    assert.equal(closeBoth.filter(x => x.status === 'rejected').length,1);
    assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:adjacent.id}})).status,'CLOSED');
    await assert.rejects(periods.update(company,user,adjacent.id,{nameEn:'Changed after close'}),/closed period cannot be changed/i);
    // Competing closure owns the row while an edit attempts to proceed.
    // After waiting, the edit must re-read CLOSED, not write stale dates.
    const editRace = await periods.create(company,user,periodDto('SYN-EDIT-RACE','2303-01-01','2303-12-31'));
    const closer = new Client({connectionString:url.toString()});
    await closer.connect();
    let pendingEdit;
    try {
      await closer.query('BEGIN');
      await closer.query('SELECT id FROM fiscal_periods WHERE id=$1 FOR UPDATE',[editRace.id]);
      pendingEdit = periods.update(company,user,editRace.id,{endDate:'2303-10-31'});
      const observedEdit = pendingEdit.then(value => ({value}),error => ({error}));
      let sawEditWait = false;
      for (let attempt=0; attempt<30; attempt++) {
        const waiting = await sql.query(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
            AND query LIKE '%FROM fiscal_periods%' AND query LIKE '%FOR UPDATE%'
            AND pid <> pg_backend_pid()) AS waiting`);
        if (waiting.rows[0].waiting) { sawEditWait = true; break; }
        await new Promise(resolve => setTimeout(resolve,50));
      }
      assert.equal(sawEditWait,true,'period edit must wait on the period lock');
      await closer.query(`UPDATE fiscal_periods SET status='CLOSED', "closedAt"=now(), "closedBy"=$2 WHERE id=$1`,[editRace.id,user]);
      await closer.query('COMMIT');
      const outcome = await observedEdit;
      assert.match(String(outcome.error?.message),/closed period cannot be changed/i);
      const saved = await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:editRace.id}});
      assert.equal(saved.status,'CLOSED');
      assert.equal(saved.endDate.toISOString().slice(0,10),'2303-12-31');
    } finally {
      try { await closer.query('ROLLBACK'); } catch { /* already committed or connection closed */ }
      await closer.end();
      if (pendingEdit) await pendingEdit.catch(() => {});
    }
    // Legacy data may already contain overlapping periods even though the
    // application now prevents new overlaps. Both close operations fail closed.
    const legacyOne = await makePeriod(2304);
    await prisma.fiscalPeriod.create({data:{companyId:company,code:'SYN-LEGACY-OVERLAP',
      nameEn:'Legacy overlap',nameAr:'تداخل تجريبي',
      startDate:new Date('2304-06-01T00:00:00Z'),endDate:new Date('2304-07-01T00:00:00Z')}});
    await assert.rejects(yearClose.close(company,user,legacyOne.id),/overlaps/);
    await assert.rejects(periods.close(company,user,legacyOne.id),/overlaps/);
    assert.equal((await prisma.fiscalPeriod.findUniqueOrThrow({where:{id:legacyOne.id}})).status,'OPEN');
    console.log('PASS: PostgreSQL application period create races, overlap edits, legacy overlap refusal, closure/edit lock, audit rollback and period/year close competition. Draft creation and direct SQL range changes remain outside this test.');


    const failStockAudit = async (action, operation) => {
      const original = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input,tx) => {
        if (input.entity === 'stock_documents' && input.action === action) throw new Error('injected stock audit failure');
        return original(input,tx);
      };
      try { await assert.rejects(operation(),/injected stock audit failure/); }
      finally { audit.recordRequired = original; }
    };
    const receiptInput = { idempotencyKey:'stock-receipt-request-0001', kind:'ADJUSTMENT', documentDate:date,
      toWarehouseId:warehouse, reason:'Synthetic receipt', lines:[{itemId:item, quantity:'10', unitCost:'7.5'}] };
    const beforeCreate = await prisma.stockDocument.count({where:{companyId:company}});
    await failStockAudit('CREATE', () => service.create(company, branch, user, receiptInput));
    assert.equal(await prisma.stockDocument.count({where:{companyId:company}}),beforeCreate);
    assert.equal(await prisma.stockDocumentCreationRequest.count({where:{companyId:company}}),0);
    const [receipt,retryReceipt] = await Promise.all([
      service.create(company, branch, user, receiptInput, false),
      service.create(company, branch, user, receiptInput, false),
    ]);
    assert.equal(receipt.id,retryReceipt.id);
    assert.equal(await prisma.stockDocument.count({where:{companyId:company}}),beforeCreate+1);
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'stock_documents',entityId:receipt.id,action:'CREATE'}}),1);
    assert.equal(receipt.lines[0].unitCost,null);
    await assert.rejects(service.create(company,branch,user,{...receiptInput,reason:'different'}),/different request/);
    await prisma.item.update({where:{id:item},data:{isStockTracked:false}});
    try { assert.equal((await service.create(company,branch,user,receiptInput,false)).id,receipt.id); }
    finally { await prisma.item.update({where:{id:item},data:{isStockTracked:true}}); }
    await assert.rejects(service.create(company,branch,user,{...receiptInput,idempotencyKey:'stock-foreign-branch-0001',
      branchId:'99999999-9999-4999-8999-999999999999'}),/Target branch/);
    await failStockAudit('POST', () => service.post(company, user, receipt.id));
    assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:receipt.id}})).status,'DRAFT');
    assert.equal(await prisma.stockMovement.count({where:{referenceId:receipt.id}}),0);
    assert.equal(await prisma.journalEntry.count({where:{sourceId:receipt.id}}),0);
    const postedReceipt = await service.post(company, user, receipt.id, false);
    assert.equal(postedReceipt.lines[0].unitCost,null);
    const issue = await service.create(company, branch, user, { kind:'ADJUSTMENT', documentDate:date,
      toWarehouseId:warehouse, costCenterId:centre, reason:'Synthetic issue',
      lines:[{itemId:item, quantity:'-4', unitCost:'1'}] });
    await service.post(company, user, issue.id);
    await assert.rejects(service.post(company, user, issue.id), /draft/i);
    const balance = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(balance.rows[0].quantity),6);
    assert.equal(Number(balance.rows[0].value),45);
    const movements = await sql.query('SELECT direction, quantity::text, "unitCost"::text, "totalCost"::text FROM stock_movements WHERE "referenceId"=$1 ORDER BY "createdAt"', [issue.id]);
    assert.equal(movements.rowCount,1);
    assert.equal(movements.rows[0].direction,'OUT');
    assert.equal(Number(movements.rows[0].quantity),4);
    assert.equal(Number(movements.rows[0].unitCost),7.5);
    assert.equal(Number(movements.rows[0].totalCost),30);
    const journal = await sql.query('SELECT l."accountId", l."costCenterId", l.debit::text, l.credit::text FROM journal_lines l JOIN journal_entries j ON j.id=l."journalEntryId" WHERE j."sourceId"=$1 ORDER BY l."lineNumber"', [issue.id]);
    assert.equal(journal.rowCount,2);
    assert(journal.rows.some(r => r.accountId === difference && r.costCenterId === centre && Number(r.debit) === 30));
    assert(journal.rows.some(r => r.accountId === inventory && Number(r.credit) === 30));
    const stockCard = await stockReports.itemLedger(company, item);
    assert.equal(stockCard.movements.length, 2);
    assert.equal(stockCard.movements.at(-1).runningQuantity, '6.0000');
    assert.equal(stockCard.movements.at(-1).runningValue, '45.0000');
    const warehouseReport = await stockReports.byWarehouse(company, {branchId: branch, itemIds: [item]});
    assert.equal(warehouseReport.find(row => row.itemId === item).total, '6.0000');
    const report = await statements.costCenterReport(company, {from: '2026-01-01', to: '2100-12-31', costCenterId: centre});
    assert.equal(report.items.find(row => row.costCenterId === centre).ownExpenses, '30.0000');
    assert.equal(report.reconciliation.balanced, true);
    const historyBefore = await sql.query('SELECT id, debit::text, credit::text FROM journal_lines WHERE "accountId"=$1 ORDER BY id', [inventory]);
    assert.equal((await chart.update(company,user,inventory,{isActive:false})).isActive,false);
    assert.equal((await chart.update(company,user,inventory,{isActive:true})).isActive,true);
    const historyAfter = await sql.query('SELECT id, debit::text, credit::text FROM journal_lines WHERE "accountId"=$1 ORDER BY id', [inventory]);
    assert.deepEqual(historyAfter.rows,historyBefore.rows);
    const excessive = await service.create(company, branch, user, { kind:'ADJUSTMENT', documentDate:date,
      toWarehouseId:warehouse, costCenterId:centre, lines:[{itemId:item, quantity:'-9'}] });
    await assert.rejects(service.post(company, user, excessive.id), /stock|warehouse/i);
    const status = await sql.query('SELECT status FROM stock_documents WHERE id=$1', [excessive.id]);
    assert.equal(status.rows[0].status, 'DRAFT');
    const after = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(after.rows[0].quantity),6);
    assert.equal(Number(after.rows[0].value),45);
    // A mismatched historic line cannot be assigned to a posted movement.
    // Reject the reversal and roll back its status and all balance writes.
    await sql.query('UPDATE stock_document_lines SET quantity=-5 WHERE "documentId"=$1', [issue.id]);
    await assert.rejects(service.reverse(company, user, issue.id), /missing or ambiguous/i);
    const stillPosted = await sql.query('SELECT status FROM stock_documents WHERE id=$1', [issue.id]);
    assert.equal(stillPosted.rows[0].status, 'POSTED');
    const unchanged = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(unchanged.rows[0].quantity),6);
    assert.equal(Number(unchanged.rows[0].value),45);
    // Emulate a legacy draft-line cost that disagrees with the immutable
    // posted movement. Reversal must use the movement's historical valuation.
    await sql.query('UPDATE stock_document_lines SET quantity=-4, "unitCost"=1 WHERE "documentId"=$1', [issue.id]);
    const movementsBeforeReverse = await prisma.stockMovement.count({where:{referenceId:issue.id}});
    const journalsBeforeReverse = await prisma.journalEntry.count({where:{companyId:company}});
    await failStockAudit('REVERSE', () => service.reverse(company, user, issue.id));
    assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:issue.id}})).status,'POSTED');
    assert.equal(await prisma.stockMovement.count({where:{referenceId:issue.id}}),movementsBeforeReverse);
    assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),journalsBeforeReverse);
    const afterAuditFailure = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(afterAuditFailure.rows[0].quantity),6);
    assert.equal(Number(afterAuditFailure.rows[0].value),45);
    const reversedIssue = await service.reverse(company, user, issue.id, false);
    assert.equal(reversedIssue.lines[0].unitCost,null);
    const restored = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(restored.rows[0].quantity),10);
    assert.equal(Number(restored.rows[0].value),75);
    const reversedCard = await stockReports.itemLedger(company, item);
    assert.equal(reversedCard.movements.at(-1).runningQuantity, '10.0000');
    assert.equal(reversedCard.movements.at(-1).runningValue, '75.0000');
    const reversedReport = await statements.costCenterReport(company, {from: '2026-01-01', to: '2100-12-31', costCenterId: centre});
    assert.equal(reversedReport.items.find(row => row.costCenterId === centre).ownExpenses, '0.0000');
    assert.equal(reversedReport.reconciliation.balanced, true);
    // A physical count belongs to one warehouse, not the branch sum. Seed
    // another pile so a branch-level reconciliation would visibly overdraw.
    const secondWarehouse = '70000000-0000-4000-8000-000000000006';
    await prisma.warehouse.create({data:{id:secondWarehouse,companyId:company,branchId:branch,
      code:'W2',nameEn:'Second synthetic warehouse',nameAr:'مخزن تجريبي آخر'}});
    const otherReceipt = await service.create(company,branch,user,{kind:'ADJUSTMENT',documentDate:date,
      toWarehouseId:secondWarehouse,lines:[{itemId:item,quantity:'10',unitCost:'7.5'}]});
    await service.post(company,user,otherReceipt.id);
    const count = await service.create(company,branch,user,{kind:'COUNT',documentDate:date,
      toWarehouseId:warehouse,lines:[{itemId:item,countedQuantity:'7',unitCost:'1'}]});
    await service.post(company,user,count.id);
    const countMovement = await prisma.stockMovement.findFirstOrThrow({where:{referenceId:count.id}});
    assert.equal(countMovement.direction,'OUT');
    assert.equal(countMovement.quantity.toFixed(4),'3.0000');
    assert.equal(countMovement.unitCost.toFixed(4),'7.5000');
    const warehouseBalance = async id => Number((await sql.query(
      `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text AS q
       FROM stock_movements WHERE "companyId"=$1 AND "warehouseId"=$2 AND "itemId"=$3`, [company,id,item])).rows[0].q);
    assert.equal(await warehouseBalance(warehouse),7);
    assert.equal(await warehouseBalance(secondWarehouse),10);
    await prisma.companySetting.update({where:{companyId:company},data:{allowNegativeStock:true}});
    try {
      const overdrawnTransfer = await service.create(company,branch,user,{kind:'TRANSFER',documentDate:date,
        fromBranchId:branch,fromWarehouseId:warehouse,toWarehouseId:secondWarehouse,
        lines:[{itemId:item,quantity:'8'}]});
      await assert.rejects(service.post(company,user,overdrawnTransfer.id),/selected warehouse/i);
      assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:overdrawnTransfer.id}})).status,'DRAFT');
      assert.equal(await warehouseBalance(warehouse),7);
      assert.equal(await warehouseBalance(secondWarehouse),10);
    } finally {
      await prisma.companySetting.update({where:{companyId:company},data:{allowNegativeStock:false}});
    }
    const countedAgain = await service.create(company,branch,user,{kind:'COUNT',documentDate:date,
      toWarehouseId:warehouse,lines:[{itemId:item,countedQuantity:'3'}]});
    const concurrentIssue = await service.create(company,branch,user,{kind:'ADJUSTMENT',documentDate:date,
      toWarehouseId:warehouse,lines:[{itemId:item,quantity:'-5'}]});
    const countRace = await Promise.allSettled([
      service.post(company,user,countedAgain.id), service.post(company,user,concurrentIssue.id),
    ]);
    assert.equal(countRace[0].status,'fulfilled');
    assert.equal(await warehouseBalance(warehouse),3);
    assert.equal(await warehouseBalance(secondWarehouse),10);
    // New receipt/issue voucher workflow: no posting before both stages,
    // separate atomic audit and retries, then one posting and one reversal.
    for (const [voucherKind, quantity] of [['RECEIPT','2'],['ISSUE','-1']]) {
      const input = {idempotencyKey:`voucher-${voucherKind.toLowerCase()}-000001`,kind:'ADJUSTMENT',voucherKind,
        documentDate:date,toWarehouseId:secondWarehouse,reason:'Synthetic workflow',counterpartyName:'Synthetic party',
        costCenterId:centre,lines:[{itemId:item,quantity,unitCost:'7.5'}]};
      if (voucherKind === 'RECEIPT') {
        await assert.rejects(service.create(company,branch,user,input,false),/inventory.cost.read/);
        const missingCost = {...input,idempotencyKey:'voucher-receipt-no-cost-01',lines:[{itemId:item,quantity}]};
        await assert.rejects(service.create(company,branch,user,missingCost,true),/unit cost is required/);
      }
      const voucher = await service.create(company,branch,user,input,true);
      assert.equal(voucher.voucherKind,voucherKind);
      assert.equal(voucher.counterpartyName,'Synthetic party');
      const found = await service.findAll(company,{branchId:branch,voucherOnly:true,q:voucher.documentNumber});
      assert.equal(found.total,1); assert.equal(found.items[0].id,voucher.id);
      assert.equal((await service.findAll(company,{branchId:'99999999-9999-4999-8999-999999999999',voucherOnly:true,q:voucher.documentNumber})).total,0);
      assert.equal((await service.findAll('99999999-9999-4999-8999-999999999999',{branchId:branch,voucherOnly:true,q:'Synthetic party'})).total,0);
      await assert.rejects(service.findAll(company,{q:'a'.repeat(121)}),/at most 120/);
      await assert.rejects(service.post(company,user,voucher.id,false,branch),/reviewed and approved/);
      await assert.rejects(service.transitionVoucher(company,branch,user,voucher.id,'APPROVE',false),/reviewed before/);
      await assert.rejects(service.transitionVoucher(company,'99999999-9999-4999-8999-999999999999',user,voucher.id,'REVIEW',false),/not found/i);
      await failStockAudit('REVIEW', () => service.transitionVoucher(company,branch,user,voucher.id,'REVIEW',false));
      assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:voucher.id}})).reviewedAt,null);
      await Promise.all([service.transitionVoucher(company,branch,user,voucher.id,'REVIEW',false),
        service.transitionVoucher(company,branch,user,voucher.id,'REVIEW',false)]);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'stock_documents',entityId:voucher.id,action:'REVIEW'}}),1);
      await failStockAudit('APPROVE', () => service.transitionVoucher(company,branch,user,voucher.id,'APPROVE',false));
      assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:voucher.id}})).approvedAt,null);
      await Promise.all([service.transitionVoucher(company,branch,user,voucher.id,'APPROVE',false),
        service.transitionVoucher(company,branch,user,voucher.id,'APPROVE',false)]);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'stock_documents',entityId:voucher.id,action:'APPROVE'}}),1);
      await assert.rejects(service.post(company,user,voucher.id,false,'99999999-9999-4999-8999-999999999999'),/not found/i);
      const postings = await Promise.allSettled([service.post(company,user,voucher.id,false,branch),service.post(company,user,voucher.id,false,branch)]);
      assert.equal(postings.filter(result => result.status === 'fulfilled').length,1);
      assert.equal(await prisma.stockMovement.count({where:{referenceId:voucher.id}}),1);
      const reversals = await Promise.allSettled([service.reverse(company,user,voucher.id,false,branch),service.reverse(company,user,voucher.id,false,branch)]);
      assert.equal(reversals.filter(result => result.status === 'fulfilled').length,1);
      assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:voucher.id}})).status,'REVERSED');
      assert.equal(await warehouseBalance(secondWarehouse),10);
    }
    // Selected non-base units are frozen at creation, including an uncertain
    // retry after the catalogue changes. Cost entered on receipts is per base
    // unit; posting and reversal must use the snapshotted base quantity.
    const voucherUnit = await prisma.itemUnit.create({data:{itemId:item,unit:'synthetic-voucher-box',factor:'2'}});
    for (const [voucherKind, quantity, baseQuantity] of [['RECEIPT','2','4.0000'],['ISSUE','-2','-4.0000']]) {
      const input = {idempotencyKey:`voucher-unit-${voucherKind.toLowerCase()}-0001`,kind:'ADJUSTMENT',voucherKind,
        documentDate:date,toWarehouseId:secondWarehouse,...(voucherKind==='ISSUE'?{costCenterId:centre}:{}),reason:'Synthetic unit',counterpartyName:'Synthetic party',
        lines:[{itemId:item,quantity,unitName:'synthetic-voucher-box',unitCost:'7.5'}]};
      const before = await warehouseBalance(secondWarehouse);
      const voucher = await service.create(company,branch,user,input,true);
      const line = await prisma.stockDocumentLine.findFirstOrThrow({where:{documentId:voucher.id}});
      assert.equal(line.quantity.toFixed(4),baseQuantity);
      assert.equal(line.unitQuantity.toFixed(4),Number(quantity).toFixed(4));
      assert.equal(line.unitFactor.toFixed(6),'2.000000');
      assert.equal(line.unitName,'synthetic-voucher-box');
      await prisma.itemUnit.update({where:{id:voucherUnit.id},data:{factor:'3',isActive:false}});
      assert.equal((await service.create(company,branch,user,input,true)).id,voucher.id);
      await assert.rejects(service.create(company,branch,user,{...input,idempotencyKey:`voucher-inactive-${voucherKind.toLowerCase()}-0001`},true),/inactive/);
      await service.transitionVoucher(company,branch,user,voucher.id,'REVIEW',true);
      await service.transitionVoucher(company,branch,user,voucher.id,'APPROVE',true);
      await service.post(company,user,voucher.id,true,branch);
      const movement = await prisma.stockMovement.findFirstOrThrow({where:{referenceId:voucher.id}});
      assert.equal(movement.quantity.toFixed(4),'4.0000');
      assert.equal(movement.direction,voucherKind === 'RECEIPT' ? 'IN' : 'OUT');
      const posted = await prisma.stockDocument.findUniqueOrThrow({where:{id:voucher.id}});
      const journal = await prisma.journalEntry.findUniqueOrThrow({where:{id:posted.journalEntryId}});
      assert.equal(journal.totalDebit.toFixed(4),journal.totalCredit.toFixed(4));
      if (voucherKind === 'RECEIPT') assert.equal(movement.totalCost.toFixed(4),'30.0000');
      assert.equal(await warehouseBalance(secondWarehouse),before + Number(baseQuantity));
      await service.reverse(company,user,voucher.id,true,branch);
      assert.equal(await warehouseBalance(secondWarehouse),before);
      assert.equal((await prisma.stockDocumentLine.findUniqueOrThrow({where:{id:line.id}})).unitFactor.toFixed(6),'2.000000');
      await prisma.itemUnit.update({where:{id:voucherUnit.id},data:{factor:'2',isActive:true}});
    }
    // Pause after the preliminary read, commit a concurrent change under the
    // same parent lock, then verify posting re-reads the locked version.
    async function pauseStockPost(doc, expectedVersion) {
      let arrived, resume;
      const barrier = new Promise(resolve => { arrived = resolve; });
      const continuation = new Promise(resolve => { resume = resolve; });
      let captured = false;
      const wrappedModel = new Proxy(prisma.stockDocument,{get(target,key) {
        const original = target[key];
        if (key === 'findFirst') return async (...args) => {
          const result = await original.apply(target,args);
          if (!captured && args[0]?.where?.id === doc.id) {
            captured = true; arrived(); await continuation;
          }
          return result;
        };
        return typeof original === 'function' ? original.bind(target) : original;
      }});
      const wrappedPrisma = new Proxy(prisma,{get(target,key) {
        if (key === 'stockDocument') return wrappedModel;
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const guarded = new StockDocumentsService(wrappedPrisma,service.numbers,service.posting,service.accounts,
        service.audit,service.settings,service.warehouses,service.costCenters,service.ledger);
      const pending = guarded.post(company,user,doc.id,true,branch,expectedVersion,expectedVersion !== undefined);
      try { await waitForBarrier(barrier,pending); } catch (error) { resume(); throw error; }
      return {pending,resume};
    }
    // Real draft edit, including concurrent retries, immutable unit snapshot,
    // authorization, optimistic conflicts, audit rollback and a post/edit race.
    const editable = await service.create(company,branch,user,{idempotencyKey:'editable-voucher-create-0001',kind:'ADJUSTMENT',
      voucherKind:'RECEIPT',documentDate:date,toWarehouseId:secondWarehouse,reason:'Before edit',counterpartyName:'Synthetic party',
      lines:[{itemId:item,quantity:'2',unitName:'synthetic-voucher-box',unitCost:'3'}]},true);
    await service.transitionVoucher(company,branch,user,editable.id,'REVIEW',true);
    await service.transitionVoucher(company,branch,user,editable.id,'APPROVE',true);
    const approvedEdit = await service.findOne(company,editable.id,true);
    assert.equal(approvedEdit.editVersion,2);
    await prisma.itemUnit.update({where:{id:voucherUnit.id},data:{factor:'5',isActive:false}});
    const draftEdit = {idempotencyKey:'editable-voucher-change-0001',expectedVersion:approvedEdit.editVersion,
      documentDate:date,toWarehouseId:secondWarehouse,reason:'After edit',counterpartyName:'Synthetic party',
      costCenterId:centre,lines:[{id:approvedEdit.lines[0].id,itemId:item,unitName:'synthetic-voucher-box',quantity:'3',unitCost:'3'},
        {itemId:item,quantity:'1',unitCost:'3'}]};
    await assert.rejects(service.updateVoucher(company,branch,user,editable.id,draftEdit,false),/inventory.cost.read/);
    await assert.rejects(service.updateVoucher(company,'99999999-9999-4999-8999-999999999999',user,editable.id,draftEdit,true),/not found/i);
    await failStockAudit('UPDATE', () => service.updateVoucher(company,branch,user,editable.id,draftEdit,true));
    assert.equal((await service.findOne(company,editable.id,true)).editVersion,2);
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM stock_voucher_edit_requests WHERE "documentId"=$1',[editable.id])).rows[0].n,0);
    const edits = await Promise.all([service.updateVoucher(company,branch,user,editable.id,draftEdit,true),
      service.updateVoucher(company,branch,user,editable.id,draftEdit,true)]);
    assert.equal(edits[0].editVersion,3); assert.equal(edits[1].editVersion,3);
    assert.equal(edits[0].reviewedAt,null); assert.equal(edits[0].approvedAt,null);
    await assert.rejects(service.transitionVoucher(company,branch,user,editable.id,'REVIEW',true,approvedEdit.editVersion),/changed/);
    await assert.rejects(service.post(company,user,editable.id,true,branch,undefined,true),/expectedVersion/);
    assert.equal(edits[0].lines[0].id,approvedEdit.lines[0].id);
    assert.equal(edits[0].lines[0].unitFactor,'2.000000'); assert.equal(edits[0].lines[0].quantity,'6.0000');
    assert.equal(edits[0].lines[1].quantity,'1.0000');
    assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'stock_documents',entityId:editable.id,action:'UPDATE'}}),1);
    await assert.rejects(service.updateVoucher(company,branch,user,editable.id,{...draftEdit,reason:'Different'},true),/idempotency key/);
    await assert.rejects(service.updateVoucher(company,branch,user,editable.id,{...draftEdit,idempotencyKey:'editable-voucher-stale-0001'},true),/changed/);
    await assert.rejects(service.post(company,user,editable.id,true,branch),/reviewed and approved/);
    await service.transitionVoucher(company,branch,user,editable.id,'REVIEW',true);
    await service.transitionVoucher(company,branch,user,editable.id,'APPROVE',true);
    const current = await service.findOne(company,editable.id,true);
    await assert.rejects(service.post(company,user,editable.id,true,branch,approvedEdit.editVersion,true),/changed/);
    const race = await pauseStockPost(editable,current.editVersion);
    try {
      await service.updateVoucher(company,branch,user,editable.id,{...draftEdit,idempotencyKey:'editable-voucher-race-0001',
        expectedVersion:current.editVersion,lines:current.lines.map(line => ({id:line.id,itemId:line.itemId,
          ...(line.unitName ? {unitName:line.unitName} : {}),quantity:line.unitQuantity,unitCost:line.unitCost}))},true);
    } finally { race.resume(); }
    await assert.rejects(race.pending,/changed/);
    assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:editable.id}})).status,'DRAFT');
    assert.equal(await prisma.stockMovement.count({where:{referenceId:editable.id}}),0);
    assert.equal(await prisma.journalEntry.count({where:{sourceId:editable.id}}),0);
    await service.transitionVoucher(company,branch,user,editable.id,'REVIEW',true);
    await service.transitionVoucher(company,branch,user,editable.id,'APPROVE',true);
    await service.post(company,user,editable.id,true,branch);
    const editedMovements = await prisma.stockMovement.findMany({where:{referenceId:editable.id},orderBy:{quantity:'desc'}});
    assert.equal(editedMovements.length,2); assert.equal(editedMovements[0].quantity.toFixed(4),'6.0000');
    assert.equal(editedMovements[1].quantity.toFixed(4),'1.0000');
    assert.equal(await warehouseBalance(secondWarehouse),17);
    await service.reverse(company,user,editable.id,true,branch);
    assert.equal(await warehouseBalance(secondWarehouse),10);

    const issueCountBefore=await prisma.stockDocument.count({where:{companyId:company}});
    await assert.rejects(service.create(company,branch,user,{idempotencyKey:'issue-without-centre-0001',kind:'ADJUSTMENT',
      voucherKind:'ISSUE',documentDate:date,toWarehouseId:secondWarehouse,reason:'Issue without centre',counterpartyName:'Synthetic department',
      lines:[{itemId:item,quantity:'-1',unitCost:'7'}]},true),/cost center is required/i);
    assert.equal(await prisma.stockDocument.count({where:{companyId:company}}),issueCountBefore);
    const editableIssue = await service.create(company,branch,user,{idempotencyKey:'editable-issue-create-0001',kind:'ADJUSTMENT',
      voucherKind:'ISSUE',documentDate:date,toWarehouseId:secondWarehouse,costCenterId:centre,reason:'Issue',counterpartyName:'Synthetic department',
      lines:[{itemId:item,quantity:'-1',unitCost:'7'}]},true);
    const issueEdit = {idempotencyKey:'editable-issue-change-0001',expectedVersion:0,documentDate:date,
      toWarehouseId:secondWarehouse,costCenterId:centre,reason:'Issue revised',counterpartyName:'Synthetic department',
      lines:[{id:editableIssue.lines[0].id,itemId:item,quantity:'-2',unitCost:'999'}]};
    await assert.rejects(service.updateVoucher(company,branch,user,editableIssue.id,{...issueEdit,
      idempotencyKey:'editable-issue-without-centre-0001',costCenterId:null},false),/cost center is required/i);
    assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:editableIssue.id}})).editVersion,0);
    const redactedIssue = await service.updateVoucher(company,branch,user,editableIssue.id,issueEdit,false);
    assert.equal(redactedIssue.lines[0].unitCost,null);
    assert.equal((await service.findOne(company,editableIssue.id,true)).lines[0].unitCost,'7.0000');
    await service.transitionVoucher(company,branch,user,editableIssue.id,'REVIEW',true);
    await service.transitionVoucher(company,branch,user,editableIssue.id,'APPROVE',true);
    await prisma.costCenter.update({where:{id:centre},data:{isActive:false}});
    try {
      await assert.rejects(service.post(company,user,editableIssue.id,true,branch),/cost center/i);
      assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:editableIssue.id}})).status,'DRAFT');
      assert.equal(await prisma.stockMovement.count({where:{referenceId:editableIssue.id}}),0);
      assert.equal(await prisma.journalEntry.count({where:{sourceId:editableIssue.id}}),0);
    } finally {await prisma.costCenter.update({where:{id:centre},data:{isActive:true}});}
    await service.post(company,user,editableIssue.id,true,branch);
    await service.reverse(company,user,editableIssue.id,true,branch);

    const anotherBranch = '70000000-0000-4000-8000-000000000009';
    const anotherWarehouse = '70000000-0000-4000-8000-000000000010';
    await prisma.branch.create({data:{id:anotherBranch,companyId:company,code:'OTHER-SYN',nameEn:'Other branch',nameAr:'فرع آخر'}});
    await prisma.warehouse.create({data:{id:anotherWarehouse,companyId:company,branchId:anotherBranch,code:'OTHER-SYN',nameEn:'Other warehouse',nameAr:'مخزن آخر'}});
    const otherVoucher = await service.create(company,anotherBranch,user,{idempotencyKey:'voucher-other-branch-0001',kind:'ADJUSTMENT',
      voucherKind:'ISSUE',documentDate:date,toWarehouseId:anotherWarehouse,costCenterId:centre,reason:'Other branch',counterpartyName:'Synthetic party',
      lines:[{itemId:item,quantity:'-1'}]},false);
    assert.equal((await service.findAll(company,{voucherOnly:true,q:otherVoucher.documentNumber},branch)).total,0);
    assert.equal((await service.findAll(company,{q:otherVoucher.documentNumber},branch)).total,0);
    assert.equal((await service.findAll(company,{voucherOnly:true,q:otherVoucher.documentNumber},anotherBranch)).total,1);
    await assert.rejects(service.findOne(company,otherVoucher.id,true,branch),/not found/i);
    await assert.rejects(service.findOne(company,otherVoucher.id,true,null),/not found/i);
    assert.equal((await service.findOne(company,otherVoucher.id,false,anotherBranch)).id,otherVoucher.id);
    const documents = new DocumentsService(prisma);
    await assert.rejects(documents.build('stock-voucher',company,otherVoucher.id,'ar',branch),/not found/i);
    await assert.rejects(documents.build('stock-voucher',company,otherVoucher.id,'ar',null),/not found/i);
    assert.equal((await documents.build('stock-voucher',company,otherVoucher.id,'ar',anotherBranch)).slug,'stock-voucher');
    await prisma.itemUnit.update({where:{id:voucherUnit.id},data:{factor:'2',isActive:true}});
    console.log('PASS: real voucher edit, historical unit, approval reset, concurrent retry, audit rollback, post race and branch-scoped read/export.');
    for (const invalidateApproval of [false,true]) {
      const voucher = await service.create(company,branch,user,{idempotencyKey:`voucher-locked-post-${invalidateApproval ? 'approval' : 'lines'}-0001`,
        kind:'ADJUSTMENT',voucherKind:'RECEIPT',documentDate:date,toWarehouseId:secondWarehouse,
        reason:'Synthetic race',counterpartyName:'Synthetic party',lines:[{itemId:item,quantity:'2',unitCost:'3'}]},true);
      await service.transitionVoucher(company,branch,user,voucher.id,'REVIEW',true);
      await service.transitionVoucher(company,branch,user,voucher.id,'APPROVE',true);
      const gate = await pauseStockPost(voucher);
      try {
        await prisma.$transaction(async tx => {
          await tx.stockDocument.update({where:{id:voucher.id},data:invalidateApproval
            ? {reviewedAt:null,reviewedBy:null,approvedAt:null,approvedBy:null}
            : {notes:'Synthetic concurrent change'}});
          await tx.stockDocumentLine.updateMany({where:{documentId:voucher.id},data:{quantity:'3'}});
        });
      } finally { gate.resume(); }
      if (invalidateApproval) {
        await assert.rejects(gate.pending,/reviewed and approved/);
        assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:voucher.id}})).status,'DRAFT');
        assert.equal(await prisma.stockMovement.count({where:{referenceId:voucher.id}}),0);
        assert.equal(await prisma.journalEntry.count({where:{sourceId:voucher.id}}),0);
      } else {
        await gate.pending;
        const movement = await prisma.stockMovement.findFirstOrThrow({where:{referenceId:voucher.id}});
        assert.equal(movement.quantity.toFixed(4),'3.0000');
        assert.equal(movement.totalCost.toFixed(4),'9.0000');
        await service.reverse(company,user,voucher.id,true,branch);
        assert.equal(await warehouseBalance(secondWarehouse),10);
      }
    }
    await require('./verify-voucher-http-real-pg.cjs')({prisma,audit,service,company,branch,item,centre,
      warehouse:secondWarehouse,date,otherVoucher,warehouseBalance});
    console.log('PASS: stock post reads locked current lines and rejects invalidated approval after a concurrent change.');
    console.log('PASS: voucher selected-unit snapshot, inactive-unit retry, base-cost posting and reversal on real PostgreSQL.');
    console.log('PASS: stock vouchers, atomic review/approval, permissions-independent workflow, posting/reversal concurrency and rollback.');
    console.log('PASS: real PostgreSQL + Prisma stock receipt, issue, audit rollback, warehouse count, concurrency, journal and reversal.');

    // Real services and Prisma on the guarded disposable database. This is
    // not an HTTP, Flutter, installed-Windows or licensed-product test.
    const customer = await prisma.customer.create({data:{companyId:company, code:'SYN-C', nameEn:'Synthetic customer', nameAr:'عميل تجريبي'}});
    const supplier = await prisma.supplier.create({data:{companyId:company, code:'SYN-S', nameEn:'Synthetic supplier', nameAr:'مورد تجريبي'}});
    const first = await prisma.item.create({data:{companyId:company, code:'SYN-ORDER-1', nameEn:'Synthetic order item', nameAr:'صنف طلب', unit:'piece', salePrice:'8', purchasePrice:'8', taxRate:'0', units:{create:[{unit:'carton',factor:'10'}]}}});
    const second = await prisma.item.create({data:{companyId:company, code:'SYN-ORDER-2', nameEn:'Synthetic second item', nameAr:'صنف ثان', unit:'piece', salePrice:'2', purchasePrice:'2', taxRate:'0'}});
    const settings = new CompanySettingsService(prisma,audit);
    const warehouses = new WarehouseService(prisma,audit);
    const prices = new PriceListsService(prisma,audit);
    const posting = new PostingService(numbers,periods,costCenters);
    const map = new AccountMapService();
    const batches = new BatchesService(prisma,warehouses,posting,map,numbers,audit,ledger);
    const si = new SalesInvoicesService(prisma,numbers,posting,map,settings,warehouses,prices,audit,batches,ledger);
    // Keep the fixture's runtime wiring explicit as this service gains
    // inventory dependencies; the production Nest module injects these.
    Object.assign(si, { batches, ledger });
    const pi = new PurchaseInvoicesService(prisma,numbers,posting,map,settings,warehouses,ledger,prices,audit);
    await require('./verify-quotation-conversion-real-pg.cjs')({prisma,numbers,settings,invoices:si,audit,company,branch,user,customer:customer.id,date});
    const sales = new SalesOrdersService(prisma,numbers,settings,prices,si,audit);
    const purchases = new PurchaseOrdersService(prisma,numbers,settings,prices,pi,audit);
    await require('./verify-order-http-real-pg.cjs')({prisma,audit,sales,purchases,company,branch,user,
      item:second.id,customer:customer.id,supplier:supplier.id,date});
    // Explicitly cleared, zero, entered and omitted taxes on both order and
    // invoice services. Historical snapshots must survive subsequent changes
    // to the item's tax and the company default, on real Prisma/PostgreSQL.
    // On create, blank/null/omitted item tax is zero. PATCH omission preserves
    // the stored value; historical invoice/order lines remain snapshots.
    await require('./verify-import-tax-real-pg.cjs')({prisma,audit,company,branch,user});
    const itemService = new ItemsService(prisma,audit,service.accounts,service.posting,service.warehouses);
    for (const [suffix,rate,expected] of [['EMPTY','','0.0000'],['NULL',null,'0.0000'],['SPACE','   ','0.0000'],['EXPLICIT','7','7.0000'],['OMIT',undefined,'0.0000']]) {
      const saved = await itemService.create(company,user,{code:`SYN-ITEM-TAX-${suffix}`,nameEn:'Synthetic tax item',nameAr:'صنف تجريبي',
        ...(rate === undefined ? {} : {taxRate:rate})},branch,true);
      assert.equal(saved.taxRate,expected);
      if (suffix === 'EXPLICIT') {
        assert.equal((await itemService.update(company,user,saved.id,{nameEn:'Changed'},true)).taxRate,'7.0000');
        assert.equal((await itemService.update(company,user,saved.id,{taxRate:''},true)).taxRate,'0.0000');
      }
    }
    console.log('PASS: real item blank/null/omitted/explicit tax on create and update.');
    const taxItem = await prisma.item.create({data:{companyId:company,code:'SYN-TAX-HISTORY',
      nameEn:'Synthetic tax history',nameAr:'ضريبة تجريبية',unit:'piece',salePrice:'100',purchasePrice:'100',taxRate:'14'}});
    const taxLines = [
      {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:''},
      {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:'0'},
      {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:'7'},
      {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:'14'},
    ];
    const snapshots = [];
    for (const [kind,orders,invoices,party] of [['sales',sales,si,customer.id],['purchase',purchases,pi,supplier.id]]) {
      const partyField=kind === 'sales' ? 'customerId' : 'supplierId';
      const order=await orders.create(company,branch,user,{[partyField]:party,orderDate:date,lines:taxLines});
      const invoice=await invoices.create(company,branch,user,{[partyField]:party,invoiceDate:date,lines:taxLines});
      const orderModel=kind === 'sales' ? prisma.salesOrder : prisma.purchaseOrder;
      const invoiceModel=kind === 'sales' ? prisma.salesInvoice : prisma.purchaseInvoice;
      snapshots.push({kind,orderId:order.id,invoiceId:invoice.id,orderModel,invoiceModel});
    }
    // Real HTTP controllers and validation, production services and real PG.
    // A test principal is injected: this does not prove JWT or licence checks.
    const httpSnapshots = [];
    let freeInvoiceId;
    class InvoiceTaxHttpModule {}
    Module({ controllers:[SalesInvoicesController,PurchaseInvoicesController,ItemsController,InventoryReportsController], providers:[
      {provide:SalesInvoicesService,useValue:si}, {provide:PurchaseInvoicesService,useValue:pi},
      {provide:ItemsService,useValue:itemService},
      {provide:InventoryReportsService,useValue:new InventoryReportsService(prisma,audit,settings)},
      {provide:BarcodeLabelsService,useValue:{}},
    ] })(InvoiceTaxHttpModule);
    const taxHttp = await NestFactory.create(InvoiceTaxHttpModule,{logger:false});
    try {
      taxHttp.use((req,_res,next)=>{req.user={userId:user,companyId:company,branchId:branch,username:'synthetic',
        isSuperAdmin:false,permissions:req.headers['x-allowed']==='yes' ? ['sales.invoices.create','purchases.invoices.create','inventory.items.read','inventory.items.create','inventory.items.update',...(req.headers['x-barcode']==='yes'?['inventory.barcodes.manage']:[])] : []};next();});
      taxHttp.useGlobalGuards(new PermissionsGuard(new Reflector()));
      taxHttp.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      taxHttp.useGlobalFilters(new ProblemDetailsFilter());
      await taxHttp.listen(0,'127.0.0.1');
      const base=`http://127.0.0.1:${taxHttp.getHttpServer().address().port}`;
      // Real item HTTP validation, permissions and persistence. An omitted
      // create field is zero; an omitted PATCH field preserves the value.
      const itemRequest=(method,path,body,allowed=true)=>fetch(base+'/inventory/items'+path,{method,
        headers:{'content-type':'application/json','x-allowed':allowed?'yes':'no'},body:JSON.stringify(body)});
      const itemCount=await prisma.item.count({where:{companyId:company}});
      assert.equal((await itemRequest('POST','',{code:'SYN-HTTP-TAX-NO',nameEn:'Synthetic',nameAr:'تجريبي',taxRate:''},false)).status,403);
      assert.equal(await prisma.item.count({where:{companyId:company}}),itemCount);
      let taxEditId;
      for (const [suffix,rate,expected] of [['EMPTY','','0.0000'],['NULL',null,'0.0000'],['SPACE','   ','0.0000'],['ZERO',0,'0.0000'],['VALUE','7','7.0000'],['OMITTED',undefined,'0.0000']]) {
        const result=await itemRequest('POST','',{code:`SYN-HTTP-TAX-${suffix}`,nameEn:'Synthetic',nameAr:'تجريبي',
          ...(rate===undefined?{}:{taxRate:rate})});
        assert.equal(result.status,201,suffix);
        const body=await result.json();
        assert.equal(body.taxRate,expected,suffix);
        const saved=await prisma.item.findUniqueOrThrow({where:{id:body.id}});
        assert.equal(saved.taxRate?.toFixed(4) ?? null,expected,suffix);
        if (suffix==='VALUE') taxEditId=body.id;
      }
      assert.equal((await itemRequest('PATCH','/'+taxEditId,{taxRate:'0'},false)).status,403);
      assert.equal((await prisma.item.findUniqueOrThrow({where:{id:taxEditId}})).taxRate.toFixed(4),'7.0000');
      for (const [rate,expected] of [['','0.0000'],[null,'0.0000'],['   ','0.0000'],[0,'0.0000'],['7','7.0000']]) {
        const updated=await itemRequest('PATCH','/'+taxEditId,{taxRate:rate});
        assert.equal(updated.status,200);
        assert.equal((await updated.json()).taxRate,expected);
        assert.equal((await prisma.item.findUniqueOrThrow({where:{id:taxEditId}})).taxRate.toFixed(4),expected);
      }
      assert.equal((await itemRequest('PATCH','/'+taxEditId,{nameEn:'Renamed synthetic'})).status,200);
      assert.equal((await prisma.item.findUniqueOrThrow({where:{id:taxEditId}})).taxRate.toFixed(4),'7.0000');
      console.log('PASS: item tax create/update matrix and denied writes through real HTTP and PostgreSQL; principal injected.');
      // Unit creation has its own barcode write path. Exercise both the outer
      // item permission and the separate barcode permission on real HTTP/PG;
      // the synthetic principal bypasses JWT and is not a licensing test.
      const unitPath='/inventory/items/'+taxItem.id+'/units';
      const unitRequest=(method,path,body,allowed,barcode)=>fetch(base+unitPath+path,{method,
        headers:{'content-type':'application/json','x-allowed':allowed?'yes':'no','x-barcode':barcode?'yes':'no'},body:JSON.stringify(body)});
      const unitsBefore=await prisma.itemUnit.count({where:{itemId:taxItem.id}});
      const draft={unit:'synthetic-auth-unit',factor:'2'};
      assert.equal((await unitRequest('POST','',{...draft,barcode:'SYN-AUTH-123'},false,true)).status,403);
      assert.equal((await unitRequest('POST','',{...draft,barcode:'SYN-AUTH-123'},true,false)).status,403);
      assert.equal((await unitRequest('POST','',{...draft,barcode:null},true,false)).status,403);
      assert.equal(await prisma.itemUnit.count({where:{itemId:taxItem.id}}),unitsBefore);
      assert.equal((await unitRequest('POST','',draft,true,false)).status,201);
      const savedUnit=await prisma.itemUnit.findFirstOrThrow({where:{itemId:taxItem.id,unit:draft.unit}});
      assert.equal(savedUnit.barcode,null);
      assert.equal((await unitRequest('PATCH','/'+savedUnit.id,{barcode:'SYN-AUTH-123'},true,false)).status,403);
      assert.equal((await prisma.itemUnit.findUniqueOrThrow({where:{id:savedUnit.id}})).barcode,null);
      assert.equal((await unitRequest('PATCH','/'+savedUnit.id,{barcode:'SYN-AUTH-123'},true,true)).status,200);
      assert.equal((await prisma.itemUnit.findUniqueOrThrow({where:{id:savedUnit.id}})).barcode,'SYN-AUTH-123');
      assert.equal((await unitRequest('POST','',{unit:'synthetic-auth-managed',factor:'3',barcode:'SYN-AUTH-456'},true,true)).status,201);
      assert.equal((await prisma.itemUnit.findFirstOrThrow({where:{itemId:taxItem.id,unit:'synthetic-auth-managed'}})).barcode,'SYN-AUTH-456');
      console.log('PASS: unit barcode create/update permission denial and authorized writes via real HTTP/PG; identity injected.');
      for (const [kind,route,partyField,party,model] of [
        ['sales','/sales/invoices','customerId',customer.id,prisma.salesInvoice],
        ['purchase','/purchases/invoices','supplierId',supplier.id,prisma.purchaseInvoice],
      ]) {
        const lines=[
          {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:''},
          {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:null},
          {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:'   '},
          {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:0},
          {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:'7'},
          {itemId:taxItem.id,quantity:'1',unitPrice:'100'},
          {itemId:taxItem.id,quantity:'1',unitPrice:'100',taxRate:'14'},
        ];
        const send=(allowed)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-allowed':allowed?'yes':'no'},
          body:JSON.stringify({[partyField]:party,invoiceDate:date,lines})});
        const before=await model.count({where:{companyId:company}});
        assert.equal((await send(false)).status,403,kind);
        assert.equal(await model.count({where:{companyId:company}}),before,kind);
        const response=await send(true);
        assert.equal(response.status,201,kind);
        const body=await response.json();
        assert.ok(body.id,kind);
        if (kind === 'sales') {
          assert.equal(body.costOfGoods,null); assert.equal(body.grossProfit,null);
          assert.ok(body.lines.every(line=>line.unitCost===null && line.costTotal===null));
        }
        const update=await fetch(base+route+'/'+body.id,{method:'PUT',headers:{'content-type':'application/json','x-allowed':'yes'},
          body:JSON.stringify({[partyField]:party,invoiceDate:date,lines})});
        assert.equal(update.status,200,`${kind} update`);
        const updated=await update.json();
        if (kind === 'sales') {
          assert.equal(updated.costOfGoods,null); assert.equal(updated.grossProfit,null);
          assert.ok(updated.lines.every(line=>line.unitCost===null && line.costTotal===null));
        }
        assert.equal(await model.count({where:{companyId:company}}),before+1,kind);
        const saved=await model.findUniqueOrThrow({where:{id:body.id},include:{lines:{orderBy:{lineNumber:'asc'}}}});
        assert.deepEqual(saved.lines.map(line=>line.taxRate.toFixed(4)),['0.0000','0.0000','0.0000','0.0000','7.0000','0.0000','14.0000'],kind);
        assert.equal(saved.taxAmount.toFixed(4),'21.0000',kind);
        assert.equal(saved.totalAmount.toFixed(4),'721.0000',kind);
        httpSnapshots.push({kind,model,id:body.id});
      }
      // With a nonzero company setting, an item-less sales line whose rate
      // was omitted or cleared remains zero; explicit nonzero still works.
      await prisma.companySetting.update({where:{companyId:company},data:{taxRate:'14'}});
      const serviceLines = [
        {description:'Synthetic free service',quantity:'1',unitPrice:'100'},
        ...[null,'','   ','0','7'].map(taxRate => ({description:'Synthetic free service',quantity:'1',unitPrice:'100',taxRate})),
      ];
      const freePayload = JSON.stringify({customerId:customer.id,invoiceDate:date,lines:serviceLines});
      const freeResponse = await fetch(base+'/sales/invoices',{method:'POST',headers:{'content-type':'application/json','x-allowed':'yes'},body:freePayload});
      assert.equal(freeResponse.status,201);
      const freeBody = await freeResponse.json();
      freeInvoiceId = freeBody.id;
      const freeInvoice = await prisma.salesInvoice.findUniqueOrThrow({where:{id:freeBody.id},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      assert.deepEqual(freeInvoice.lines.map(line=>line.taxRate.toFixed(4)),['0.0000','0.0000','0.0000','0.0000','0.0000','7.0000']);
      assert.equal(freeInvoice.taxAmount.toFixed(4),'7.0000');
      const freeUpdate = await fetch(base+'/sales/invoices/'+freeBody.id,{method:'PUT',headers:{'content-type':'application/json','x-allowed':'yes'},body:freePayload});
      assert.equal(freeUpdate.status,200);
      const freeUpdated = await prisma.salesInvoice.findUniqueOrThrow({where:{id:freeBody.id},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      assert.deepEqual(freeUpdated.lines.map(line=>line.taxRate.toFixed(4)),['0.0000','0.0000','0.0000','0.0000','0.0000','7.0000']);
      assert.equal(freeUpdated.taxAmount.toFixed(4),'7.0000');
      console.log('PASS: free-text sales invoice omitted/blank/null/explicit tax over real HTTP and PG, create and update; principal injected.');
      // Barcode lookup must expose the exact factor, even when one scan cannot
      // be represented by the ledger. The same HTTP-to-service-to-PG path must
      // reject an inexact invoice quantity rather than silently round stock.
      for (const [unitName,barcode,factor,exactQuantity] of [
        ['synthetic-precise','SYN-BARCODE-PRECISE','1.234567','123.4567'],
        ['synthetic-micro','SYN-BARCODE-MICRO','0.000001','0.0001'],
      ]) {
        await prisma.itemUnit.create({data:{itemId:taxItem.id,unit:unitName,barcode,factor}});
        const barcodeUrl=base+'/inventory/items/by-barcode/'+barcode;
        assert.equal((await fetch(barcodeUrl)).status,403);
        const lookup=await fetch(barcodeUrl,{headers:{'x-allowed':'yes'}});
        assert.equal(lookup.status,200);
        const resolved=await lookup.json();
        assert.equal(resolved.factor,factor);
        assert.equal(resolved.quantityPerScan,factor);
        assert.equal(resolved.quantityPerScanFitsLedgerScale,false);
        assert.equal(resolved.purchasePrice,null);
        const post=(quantity)=>fetch(base+'/sales/invoices',{method:'POST',headers:{'content-type':'application/json','x-allowed':'yes'},
          body:JSON.stringify({customerId:customer.id,invoiceDate:date,lines:[{itemId:taxItem.id,unitName,quantity,unitPrice:'100',taxRate:'0'}]})});
        const before=await prisma.salesInvoice.count({where:{companyId:company}});
        assert.equal((await post('1')).status,400);
        assert.equal(await prisma.salesInvoice.count({where:{companyId:company}}),before);
        const accepted=await post('100');
        assert.equal(accepted.status,201);
        const result=await accepted.json();
        const invoice=await prisma.salesInvoice.findUniqueOrThrow({where:{id:result.id},include:{lines:true}});
        assert.equal(invoice.lines[0].quantity.toFixed(4),exactQuantity);
        assert.equal(invoice.lines[0].unitFactor.toFixed(6),factor);
      }
      console.log('PASS: barcode exact precision, cost redaction and inexact invoice rejection over real HTTP/PG; identity injected.');
    } finally { await taxHttp.close(); }
    assert.equal((await itemService.update(company,user,taxItem.id,{taxRate:''},true)).taxRate,'0.0000');
    await prisma.companySetting.update({where:{companyId:company},data:{taxRate:'3'}});
    const freeAfterChange = await prisma.salesInvoice.findUniqueOrThrow({where:{id:freeInvoiceId},include:{lines:{orderBy:{lineNumber:'asc'}}}});
    assert.deepEqual(freeAfterChange.lines.map(line=>line.taxRate.toFixed(4)),['0.0000','0.0000','0.0000','0.0000','0.0000','7.0000']);
    assert.equal(freeAfterChange.taxAmount.toFixed(4),'7.0000');
    for (const snapshot of snapshots) {
      const order=await snapshot.orderModel.findUniqueOrThrow({where:{id:snapshot.orderId},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      const invoice=await snapshot.invoiceModel.findUniqueOrThrow({where:{id:snapshot.invoiceId},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      for (const document of [order,invoice]) {
        assert.deepEqual(document.lines.map(line => line.taxRate.toFixed(4)),['0.0000','0.0000','7.0000','14.0000'],snapshot.kind);
        assert.equal(document.taxAmount.toFixed(4),'21.0000');
        assert.equal(document.totalAmount.toFixed(4),'421.0000');
      }
    }
    for (const snapshot of httpSnapshots) {
      const invoice=await snapshot.model.findUniqueOrThrow({where:{id:snapshot.id},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      assert.deepEqual(invoice.lines.map(line=>line.taxRate.toFixed(4)),['0.0000','0.0000','0.0000','0.0000','7.0000','0.0000','14.0000'],snapshot.kind);
      assert.equal(invoice.taxAmount.toFixed(4),'21.0000',snapshot.kind);
    }
    await prisma.companySetting.update({where:{companyId:company},data:{taxRate:'14'}});
    // Historical catalogue rows can still contain null. With a 14% company
    // rate and an omitted line rate, a *new* document must use zero rather
    // than inheriting 14%; this does not rewrite existing document lines.
    const legacyNullItem = await prisma.item.create({data:{companyId:company,code:'SYN-LEGACY-NULL-TAX',
      nameEn:'Legacy null tax',nameAr:'صنف تجريبي قديم',unit:'piece',salePrice:'100',purchasePrice:'100',taxRate:null}});
    for (const [kind,orders,invoices,party] of [['sales',sales,si,customer.id],['purchase',purchases,pi,supplier.id]]) {
      const partyField = kind === 'sales' ? 'customerId' : 'supplierId';
      const lines = [{itemId:legacyNullItem.id,quantity:'1',unitPrice:'100'}];
      const order = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,lines});
      const invoice = await invoices.create(company,branch,user,{[partyField]:party,invoiceDate:date,lines});
      for (const [model,id] of [
        [kind === 'sales' ? prisma.salesOrder : prisma.purchaseOrder, order.id],
        [kind === 'sales' ? prisma.salesInvoice : prisma.purchaseInvoice, invoice.id],
      ]) {
        const stored = await model.findUniqueOrThrow({where:{id},include:{lines:true}});
        assert.equal(stored.lines[0].taxRate.toFixed(4),'0.0000',kind);
        assert.equal(stored.taxAmount.toFixed(4),'0.0000',kind);
      }
    }
    assert.equal((await prisma.item.findUniqueOrThrow({where:{id:legacyNullItem.id}})).taxRate,null);
    console.log('PASS: legacy null item tax yields zero in new sales/purchase orders and invoices; old catalogue row is not rewritten.');
    console.log('PASS: real HTTP/PG sale and purchase invoices preserve blank/null/space/zero versus explicit and omitted tax; historical snapshots persist after defaults change. Principal injected; JWT and licence guards untested.');
    // Creation retries: a real unique ledger, order and required audit must
    // commit together; both concurrent callers receive the same order.
    for (const [kind, orders, party] of [['sales',sales,customer.id],['purchase',purchases,supplier.id]]) {
      const partyField = kind === 'sales' ? 'customerId' : 'supplierId';
      const orderModel = kind === 'sales' ? prisma.salesOrder : prisma.purchaseOrder;
      const key = `create-${kind}-concurrent-00001`;
      const payload = {[partyField]:party,orderDate:date,idempotencyKey:key,lines:[{itemId:second.id,quantity:'2',unitPrice:'2'}]};
      const before = await orderModel.count({where:{companyId:company}});
      const [a,b] = await Promise.all([orders.create(company,branch,user,payload),orders.create(company,branch,user,payload)]);
      assert.equal(a.id,b.id);
      assert.equal(await orderModel.count({where:{companyId:company}}),before+1);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM order_creation_requests WHERE "companyId"=$1 AND kind=$2 AND "requestKey"=$3',[company,kind,key])).rows[0].n,1);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_orders`,entityId:a.id,action:'CREATE'}}),1);
      await assert.rejects(orders.create(company,branch,user,{...payload,lines:[{itemId:second.id,quantity:'3'}]}),/different request/);
      const failKey = `create-${kind}-audit-failure-01`;
      const originalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input,tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'CREATE') throw new Error('injected order creation audit failure');
        return originalAudit(input,tx);
      };
      try { await assert.rejects(orders.create(company,branch,user,{...payload,idempotencyKey:failKey}),/injected order creation audit failure/); }
      finally { audit.recordRequired = originalAudit; }
      assert.equal(await orderModel.count({where:{companyId:company}}),before+1);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM order_creation_requests WHERE "companyId"=$1 AND kind=$2 AND "requestKey"=$3',[company,kind,failKey])).rows[0].n,0);
      const recovered = await orders.create(company,branch,user,{...payload,idempotencyKey:failKey});
      assert.ok(recovered.id);
    }
    console.log('PASS: order creation idempotency, conflicting payloads, concurrency and audit rollback for both types.');
    // Draft edits preserve existing line IDs and historical unit factors.
    // The fixture verifies retry, stale writes and required-audit rollback on
    // real Prisma transactions, then refuses an approved order amendment.
    for (const [kind, orders, party] of [['sales',sales,customer.id],['purchase',purchases,supplier.id]]) {
      const partyField = kind === 'sales' ? 'customerId' : 'supplierId';
      const model = kind === 'sales' ? prisma.salesOrder : prisma.purchaseOrder;
      const draft = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,
        lines:[{itemId:first.id,quantity:'3',unitName:'carton',unitPrice:'100',discountPercent:'5',taxRate:'14'}]});
      await prisma.itemUnit.update({where:{itemId_unit:{itemId:first.id,unit:'carton'}},data:{factor:'12',isActive:false}});
      const request = { idempotencyKey:`draft-${kind}-update-00001`, expectedUpdatedAt:draft.updatedAt,
        lines:[{orderLineId:draft.lines[0].id,quantity:'2',unitPrice:'100',discountPercent:'5',taxRate:'14'}] };
      const updated = await orders.updateDraft(company,branch,user,draft.id,request);
      assert.equal(updated.lines[0].id,draft.lines[0].id);
      assert.equal(updated.lines[0].baseQuantity,'20.0000');
      assert.equal(updated.lines[0].unitFactor,'10.000000');
      assert.equal(updated.totalAmount,'216.6000');
      assert.notEqual(updated.updatedAt,draft.updatedAt);
      assert.equal((await orders.updateDraft(company,branch,user,draft.id,request)).id,draft.id);
      await assert.rejects(orders.updateDraft(company,branch,user,draft.id,{...request, lines:[{...request.lines[0],quantity:'3'}]}),/different request/);
      await assert.rejects(orders.updateDraft(company,branch,user,draft.id,{...request,idempotencyKey:`draft-${kind}-stale-000001`}),
        error => error.getResponse?.()?.code === 'ORDER_EDIT_STALE');
      const fail = {...request,idempotencyKey:`draft-${kind}-audit-fail-001`,expectedUpdatedAt:updated.updatedAt,
        lines:[{...request.lines[0],quantity:'4'}]};
      const originalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input,tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'UPDATE') throw new Error('injected draft edit audit failure');
        return originalAudit(input,tx);
      };
      try { await assert.rejects(orders.updateDraft(company,branch,user,draft.id,fail),/injected draft edit audit failure/); }
      finally { audit.recordRequired = originalAudit; }
      assert.equal((await model.findUnique({where:{id:draft.id}})).totalAmount.toFixed(4),'216.6000');
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM order_creation_requests WHERE "companyId"=$1 AND "requestKey"=$2',[company,fail.idempotencyKey])).rows[0].n,0);
      await orders.approve(company,user,draft.id);
      await assert.rejects(orders.updateDraft(company,branch,user,draft.id,{...fail,idempotencyKey:`draft-${kind}-approved-0001`}),/Only draft/);
      await prisma.itemUnit.update({where:{itemId_unit:{itemId:first.id,unit:'carton'}},data:{factor:'10',isActive:true}});
      const race = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'3',unitPrice:'2',taxRate:'0'}]});
      const base = {expectedUpdatedAt:race.updatedAt,lines:[{orderLineId:race.lines[0].id,
        quantity:'2',unitPrice:'2',discountPercent:'0',taxRate:'0'}]};
      const competing = await Promise.allSettled([
        orders.updateDraft(company,branch,user,race.id,{...base,idempotencyKey:`draft-${kind}-race-key-0001`}),
        orders.updateDraft(company,branch,user,race.id,{...base,idempotencyKey:`draft-${kind}-race-key-0002`}),
      ]);
      assert.equal(competing.filter(result => result.status === 'fulfilled').length,1);
      assert.equal(competing.filter(result => result.status === 'rejected').length,1);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_orders`,entityId:race.id,action:'UPDATE'}}),1);
      const raceAfter = await orders.findOne(company,race.id);
      assert.equal(raceAfter.lines[0].baseQuantity,'2.0000');
    }
    console.log('PASS: draft order edit, historical factors, retry, concurrency, stale update and audit rollback for both types.');
    const lines = [{itemId:first.id,quantity:'3',unitName:'carton',unitPrice:'100',discountPercent:'5',taxRate:'14'},
      {itemId:second.id,quantity:'5',unitPrice:'2',taxRate:'0'}];
    const so = await sales.create(company,branch,user,{customerId:customer.id,orderDate:date,lines});
    const po = await purchases.create(company,branch,user,{supplierId:supplier.id,orderDate:date,lines});
    for (const [kind, orders, order] of [['sales',sales,so],['purchase',purchases,po]]) {
      const model = kind === 'sales' ? prisma.salesOrder : prisma.purchaseOrder;
      const originalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input,tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'APPROVE') throw new Error('injected order approval audit failure');
        return originalAudit(input,tx);
      };
      try { await assert.rejects(orders.approve(company,user,order.id),/injected order approval audit failure/); }
      finally { audit.recordRequired = originalAudit; }
      const rolledBack = await model.findUnique({where:{id:order.id}});
      assert.equal(rolledBack.status,'DRAFT');
      assert.equal(rolledBack.approvedBy,null);
      assert.equal(rolledBack.approvedAt,null);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_orders`,entityId:order.id,action:'APPROVE'}}),0);
      await orders.approve(company,user,order.id);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_orders`,entityId:order.id,action:'APPROVE'}}),1);
    }
    await prisma.itemUnit.update({where:{itemId_unit:{itemId:first.id,unit:'carton'}},data:{factor:'12',isActive:false}});
    await prisma.companySetting.update({where:{companyId:company},data:{pricesIncludeTax:true}});
    const converted = {};
    for (const [kind, orders, order] of [['sales',sales,so],['purchase',purchases,po]]) {
      const orderLines = kind === 'sales'
        ? await prisma.salesOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}})
        : await prisma.purchaseOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}});
      await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,{}),/Select the order lines/);
      const selected = [{orderLineId:orderLines[0].id,quantity:'20'}];
      await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,{invoiceDate:date,lines:selected}),/idempotencyKey/);
      const countInvoices = () => kind === 'sales'
        ? prisma.salesInvoice.count({where:{companyId:company}}) : prisma.purchaseInvoice.count({where:{companyId:company}});
      const beforeInvoices = await countInvoices();
      const beforeMoves = await prisma.stockMovement.count({where:{companyId:company}});
      const beforeJournals = await prisma.journalEntry.count({where:{companyId:company}});
      // Fail after both the invoice and allocations were written, while the
      // transaction is still open: none of them or either audit may survive.
      const originalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'INVOICE') throw new Error('injected audit failure');
        return originalAudit(input, tx);
      };
      try {
        await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,
          {idempotencyKey:'failure-request-00000001',invoiceDate:date,lines:selected}),/injected audit failure/);
      } finally { audit.recordRequired = originalAudit; }
      assert.equal(await countInvoices(),beforeInvoices);
      assert.equal(await prisma.stockMovement.count({where:{companyId:company}}),beforeMoves);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),beforeJournals);
      const afterFailure = kind === 'sales'
        ? await prisma.salesOrderLine.findUniqueOrThrow({where:{id:orderLines[0].id}})
        : await prisma.purchaseOrderLine.findUniqueOrThrow({where:{id:orderLines[0].id}});
      assert.equal(afterFailure.invoicedQuantity.toFixed(4),'0.0000');
      const request = () => orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'same-request-000000001',invoiceDate:date,lines:selected});
      const [conversion, retry] = await Promise.all([request(),request()]);
      assert.equal(conversion.invoice.id,retry.invoice.id,`${kind}: retry created another invoice`);
      assert.equal(await countInvoices(),beforeInvoices+1);
      await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'same-request-000000001',invoiceDate:date,lines:[{orderLineId:orderLines[0].id,quantity:'10'}]}),/different request/);
      const saved = kind === 'sales'
        ? await prisma.salesInvoice.findUniqueOrThrow({where:{id:conversion.invoice.id},include:{lines:true}})
        : await prisma.purchaseInvoice.findUniqueOrThrow({where:{id:conversion.invoice.id},include:{lines:true}});
      assert.equal(saved.lines.length,1,`${kind}: an unselected line was invoiced`);
      assert.equal(saved.lines[0].itemId,first.id);
      assert.equal(saved.lines[0].orderLineId,orderLines[0].id);
      converted[kind] = { invoiceId:saved.id, invoiceLineId:saved.lines[0].id, orderId:order.id, orderLineId:orderLines[0].id };
      assert.equal(saved.lines[0].quantity.toFixed(4),'20.0000');
      assert.equal(saved.lines[0].unitFactor.toFixed(6),'10.000000');
      assert.equal(saved.lines[0].unitQuantity.toFixed(4),'2.0000');
      assert.equal(saved.lines[0].discountPercent.toFixed(4),'5.0000');
      assert.equal(saved.lines[0].lineTotal.toFixed(4),'190.0000');
      assert.equal(saved.lines[0].taxAmount.toFixed(4),'26.6000');
      assert.equal(saved.totalAmount.toFixed(4),'216.6000');
      const refreshed = kind === 'sales'
        ? await prisma.salesOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}})
        : await prisma.purchaseOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}});
      assert.equal(refreshed[0].invoicedQuantity.toFixed(4),'20.0000');
      assert.equal(refreshed[1].invoicedQuantity.toFixed(4),'0.0000');
      // No ordinary order edit may change a partially allocated promise or
      // rewrite the invoice snapshot. A separate approved amendment workflow
      // is required for that case.
      const partialOrder = await orders.findOne(company,order.id);
      assert.equal(partialOrder.status,'PARTIALLY_FULFILLED');
      await assert.rejects(orders.updateDraft(company,branch,user,order.id,{
        idempotencyKey:`partial-${kind}-edit-0001`,expectedUpdatedAt:partialOrder.updatedAt,
        lines:partialOrder.lines.map(line => ({orderLineId:line.id,quantity:line.unitQuantity,
          unitPrice:'1',discountPercent:'0',taxRate:'0'})),
      }),/Only draft/);
      const amendment = {idempotencyKey:`partial-${kind}-amend-0001`,expectedUpdatedAt:partialOrder.updatedAt,
        lines:partialOrder.lines.map((line,index) => ({orderLineId:line.id,quantity:line.unitQuantity,
          unitPrice:index === 1 ? '3' : line.unitPrice,discountPercent:line.discountPercent,taxRate:line.taxRate}))};
      const below = structuredClone(amendment); below.idempotencyKey=`partial-${kind}-below-0001`; below.lines[0].quantity='1';
      await assert.rejects(orders.amend(company,branch,user,order.id,below),/less than the allocated/);
      const reprice = structuredClone(amendment); reprice.idempotencyKey=`partial-${kind}-reprice-01`; reprice.lines[0].unitPrice='1';
      await assert.rejects(orders.amend(company,branch,user,order.id,reprice),/Financial terms/);
      const invoiceLineModel = kind === 'sales' ? prisma.salesInvoiceLine : prisma.purchaseInvoiceLine;
      await invoiceLineModel.update({where:{id:saved.lines[0].id},data:{orderLineId:null}});
      try { await assert.rejects(orders.amend(company,branch,user,order.id,amendment),/manual review/); }
      finally { await invoiceLineModel.update({where:{id:saved.lines[0].id},data:{orderLineId:orderLines[0].id}}); }
      const originalAmendAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'AMEND') throw new Error('injected amendment audit failure');
        return originalAmendAudit(input,tx);
      };
      try { await assert.rejects(orders.amend(company,branch,user,order.id,amendment),/injected amendment audit failure/); }
      finally { audit.recordRequired = originalAmendAudit; }
      assert.equal((await orders.findOne(company,order.id)).lines[1].unitPrice,'2.0000');
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_orders`,entityId:order.id,action:'AMEND'}}),0);
      const [amended,replayed] = await Promise.all([
        orders.amend(company,branch,user,order.id,amendment),orders.amend(company,branch,user,order.id,amendment),
      ]);
      assert.equal(amended.lines[1].unitPrice,'3.0000');
      assert.equal(replayed.id,amended.id);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_orders`,entityId:order.id,action:'AMEND'}}),1);
      await assert.rejects(orders.amend(company,branch,user,order.id,{...amendment,lines:below.lines}),/different request/);
      const staleAmend = {...amendment,idempotencyKey:`partial-${kind}-stale-0001`};
      await assert.rejects(orders.amend(company,branch,user,order.id,staleAmend),error => error.getResponse?.()?.code === 'ORDER_EDIT_STALE');
      const unchanged = kind === 'sales'
        ? await prisma.salesInvoice.findUniqueOrThrow({where:{id:saved.id},include:{lines:true}})
        : await prisma.purchaseInvoice.findUniqueOrThrow({where:{id:saved.id},include:{lines:true}});
      assert.equal(unchanged.lines[0].unitPrice.toFixed(4),saved.lines[0].unitPrice.toFixed(4));
      assert.equal(unchanged.lines[0].taxRate.toFixed(4),saved.lines[0].taxRate.toFixed(4));
      assert.equal(unchanged.lines[0].quantity.toFixed(4),saved.lines[0].quantity.toFixed(4));
      // Two different keys compete for the same remaining ten base units.
      const compete = key => orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:key,invoiceDate:date,lines:[{orderLineId:orderLines[0].id,quantity:'10'}]});
      const attempts = await Promise.allSettled([compete('competing-request-000001'),compete('competing-request-000002')]);
      assert.equal(attempts.filter(x => x.status === 'fulfilled').length,1);
      assert.equal(attempts.filter(x => x.status === 'rejected').length,1);
      await orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'final-line-request-00001',invoiceDate:date,lines:[{orderLineId:orderLines[1].id,quantity:'5'}]});
      const completed = kind === 'sales' ? await prisma.salesOrder.findUniqueOrThrow({where:{id:order.id}})
        : await prisma.purchaseOrder.findUniqueOrThrow({where:{id:order.id}});
      assert.equal(completed.status,'FULFILLED');
    }
    // Configure the synthetic chart, post the purchased stock, sell it, then
    // reverse both. Legacy/missing line links must abort without stock, journal
    // or order mutations; a successful reversal releases the allocation.
    for (const [code, type] of [['1103','ASSET'],['2101','LIABILITY'],['1104','ASSET'],
      ['1105','ASSET'],['2103','LIABILITY'],['4101','REVENUE'],['4102','REVENUE'],['5101','EXPENSE']]) {
      await prisma.account.upsert({where:{companyId_code:{companyId:company,code}},
        create:{companyId:company,code,nameEn:`Synthetic ${code}`,nameAr:`تجريبي ${code}`,type,isPostable:true},
        update:{isActive:true,isPostable:true,deletedAt:null}});
    }
    await assert.rejects(si.updateDraft(company,branch,user,converted.sales.invoiceId,{}),/allocation reconciliation/);
    await assert.rejects(pi.updateDraft(company,branch,user,converted.purchase.invoiceId,{}),/allocation reconciliation/);
    // Actual invoice controller/service/PG with the cost permission varied at
    // the HTTP edge. Identity is injected, so this is not a JWT test.
    async function salesInvoiceHttp(method,path,mayReadCost,allowed=true) {
      class SalesInvoiceFixtureModule {}
      Module({controllers:[SalesInvoicesController],providers:[{provide:SalesInvoicesService,useValue:si}]})(SalesInvoiceFixtureModule);
      const app=await NestFactory.create(SalesInvoiceFixtureModule,{logger:false});
      app.use((req,_res,next)=>{req.user={companyId:company,userId:user,branchId:branch,isSuperAdmin:false,
        permissions:allowed ? ['sales.invoices.post','sales.invoices.read',...(mayReadCost?['inventory.cost.read']:[])] : []};next();});
      app.useGlobalGuards(new PermissionsGuard(new Reflector())); app.useGlobalFilters(new ProblemDetailsFilter());
      try {
        await app.listen(0,'127.0.0.1');
        const response=await fetch(`http://127.0.0.1:${app.getHttpServer().address().port}/sales/invoices/${path}`,{method});
        return {status:response.status,body:await response.json()};
      } finally { await app.close(); }
    }
    await pi.post(company,user,converted.purchase.invoiceId);
    const returns = new ReturnsService(prisma,numbers,posting,map,audit,warehouses);
    await require('./verify-return-http-real-pg.cjs')({prisma,returns,company,user,branch,item:first.id,date,
      kind:'purchase',invoiceId:converted.purchase.invoiceId,lineId:converted.purchase.invoiceLineId});
    assert.equal((await salesInvoiceHttp('POST',`${converted.sales.invoiceId}/post`,false,false)).status,403);
    assert.equal((await prisma.salesInvoice.findUniqueOrThrow({where:{id:converted.sales.invoiceId}})).status,'DRAFT');
    const salesPosted=await salesInvoiceHttp('POST',`${converted.sales.invoiceId}/post`,false);
    assert.equal(salesPosted.status,201);
    assert.equal(salesPosted.body.costOfGoods,null); assert.equal(salesPosted.body.grossProfit,null);
    assert.ok(salesPosted.body.lines.every(line=>line.unitCost===null && line.costTotal===null));
    const salesAllowed=await salesInvoiceHttp('GET',converted.sales.invoiceId,true);
    assert.equal(salesAllowed.status,200);
    assert.ok(Number(salesAllowed.body.costOfGoods)>0);
    assert.ok(Number(salesAllowed.body.lines[0].unitCost)>0);
    await require('./verify-return-http-real-pg.cjs')({prisma,returns,company,user,branch,item:first.id,date,
      kind:'sales',invoiceId:converted.sales.invoiceId,lineId:converted.sales.invoiceLineId});
    let orderStockState = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:first.id}}});
    assert.equal(orderStockState.quantity.toFixed(4),'0.0000');
    for (const [kind, svc, orders] of [['sales',si,sales],['purchase',pi,purchases]]) {
      const target = converted[kind];
      const invoiceLines = kind === 'sales' ? prisma.salesInvoiceLine : prisma.purchaseInvoiceLine;
      const invoiceModel = kind === 'sales' ? prisma.salesInvoice : prisma.purchaseInvoice;
      const orderLineModel = kind === 'sales' ? prisma.salesOrderLine : prisma.purchaseOrderLine;
      await invoiceLines.update({where:{id:target.invoiceLineId},data:{orderLineId:null}});
      const movements = await prisma.stockMovement.count({where:{companyId:company}});
      const journals = await prisma.journalEntry.count({where:{companyId:company}});
      await assert.rejects(svc.reverse(company,user,target.invoiceId),/manual review/);
      assert.equal((await invoiceModel.findUniqueOrThrow({where:{id:target.invoiceId}})).status,'POSTED');
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:target.orderLineId}})).invoicedQuantity.toFixed(4),'30.0000');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company}}),movements);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),journals);
      await invoiceLines.update({where:{id:target.invoiceLineId},data:{orderLineId:target.orderLineId}});
      const beforeReversalInvoice = await invoiceModel.findUniqueOrThrow({where:{id:target.invoiceId}});
      const beforeReversalJournal = await prisma.journalEntry.findUniqueOrThrow({where:{id:beforeReversalInvoice.journalEntryId}});
      const beforeReversalStock = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:first.id}}});
      const reversalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_invoices` && input.action === 'REVERSE') throw new Error('injected reversal audit failure');
        return reversalAudit(input, tx);
      };
      try { await assert.rejects(svc.reverse(company,user,target.invoiceId),/injected reversal audit failure/); }
      finally { audit.recordRequired = reversalAudit; }
      assert.equal((await invoiceModel.findUniqueOrThrow({where:{id:target.invoiceId}})).status,'POSTED');
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:target.orderLineId}})).invoicedQuantity.toFixed(4),'30.0000');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company}}),movements);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),journals);
      assert.equal((await prisma.journalEntry.findUniqueOrThrow({where:{id:beforeReversalInvoice.journalEntryId}})).status,beforeReversalJournal.status);
      const afterReversalStock = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:first.id}}});
      assert.equal(afterReversalStock.quantity.toFixed(4),beforeReversalStock.quantity.toFixed(4));
      assert.equal(afterReversalStock.value.toFixed(4),beforeReversalStock.value.toFixed(4));
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_invoices`,entityId:target.invoiceId,action:'REVERSE'}}),0);
      if (kind === 'sales') {
        const reversed=await salesInvoiceHttp('POST',`${target.invoiceId}/reverse`,false);
        assert.equal(reversed.status,201);
        assert.equal(reversed.body.costOfGoods,null); assert.equal(reversed.body.grossProfit,null);
        assert.ok(reversed.body.lines.every(line=>line.unitCost===null && line.costTotal===null));
      } else {
        await svc.reverse(company,user,target.invoiceId);
      }
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_invoices`,entityId:target.invoiceId,action:'REVERSE'}}),1);
      assert.equal((await invoiceModel.findUniqueOrThrow({where:{id:target.invoiceId}})).status,'REVERSED');
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:target.orderLineId}})).invoicedQuantity.toFixed(4),'10.0000');
      await assert.rejects(svc.reverse(company,user,target.invoiceId),/Only posted/);
      await assert.rejects(orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'same-request-000000001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]}),/no longer active/);
      const reissued = await orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'reconverted-request-0001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]});
      await svc.cancelDraft(company,branch,user,reissued.invoice.id);
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:target.orderLineId}})).invoicedQuantity.toFixed(4),'10.0000');
      assert.ok((await invoiceModel.findUniqueOrThrow({where:{id:reissued.invoice.id}})).deletedAt);
      await assert.rejects(orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'reconverted-request-0001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]}),/no longer active/);
      await orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'after-draft-cancel-00001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]});
    }
    orderStockState = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:first.id}}});
    assert.equal(orderStockState.quantity.toFixed(4),'0.0000');
    assert.equal(orderStockState.value.toFixed(4),'0.0000');
    for (const [kind, orders, invoices, party] of [['sales',sales,si,customer.id],['purchase',purchases,pi,supplier.id]]) {
      const partyField = kind === 'sales' ? 'customerId' : 'supplierId';
      const full = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,lines:[
        {itemId:first.id,quantity:'3',unitPrice:'7',taxRate:'14'},
        {itemId:second.id,quantity:'5',unitPrice:'2',taxRate:'0'},
      ]});
      await orders.approve(company,user,full.id);
      const rows = kind === 'sales' ? await prisma.salesOrderLine.findMany({where:{orderId:full.id},orderBy:{lineNumber:'asc'}})
        : await prisma.purchaseOrderLine.findMany({where:{orderId:full.id},orderBy:{lineNumber:'asc'}});
      const result = await orders.convertToInvoice(company,branch,user,full.id,{idempotencyKey:'full-order-request-00001',invoiceDate:date,
        lines:rows.map(row => ({orderLineId:row.id,quantity:row.quantity.toFixed(4)}))});
      assert.equal(result.order.status,'FULFILLED');
      assert.equal(result.invoice.lines.length,2);
      await assert.rejects(orders.cancel(company,user,full.id),/active invoices/);
      await invoices.cancelDraft(company,branch,user,result.invoice.id);
      const orderAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'CANCEL') throw new Error('injected order cancel audit failure');
        return orderAudit(input, tx);
      };
      try { await assert.rejects(orders.cancel(company,user,full.id,'audit failure'),/injected order cancel audit failure/); }
      finally { audit.recordRequired = orderAudit; }
      const afterCancelFailure = kind === 'sales' ? await prisma.salesOrder.findUniqueOrThrow({where:{id:full.id}})
        : await prisma.purchaseOrder.findUniqueOrThrow({where:{id:full.id}});
      assert.equal(afterCancelFailure.status,'APPROVED');
      await orders.cancel(company,user,full.id,'synthetic cancellation');
      const finalOrder = kind === 'sales' ? await prisma.salesOrder.findUniqueOrThrow({where:{id:full.id}})
        : await prisma.purchaseOrder.findUniqueOrThrow({where:{id:full.id}});
      assert.equal(finalOrder.status,'CANCELLED');

      // An amendment and a conversion compete for the same remaining units.
      const amendRace = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'10',unitPrice:'2',taxRate:'0'}]});
      await orders.approve(company,user,amendRace.id);
      await orders.convertToInvoice(company,branch,user,amendRace.id,{idempotencyKey:'amend-race-initial-00001',invoiceDate:date,
        lines:[{orderLineId:amendRace.lines[0].id,quantity:'4'}]});
      const raceSnapshot = await orders.findOne(company,amendRace.id);
      const raceResults = await Promise.allSettled([
        orders.amend(company,branch,user,amendRace.id,{idempotencyKey:'amend-race-update-000001',expectedUpdatedAt:raceSnapshot.updatedAt,
          lines:[{orderLineId:raceSnapshot.lines[0].id,quantity:'6',unitPrice:'2',discountPercent:'0',taxRate:'0'}]}),
        orders.convertToInvoice(company,branch,user,amendRace.id,{idempotencyKey:'amend-race-invoice-00001',invoiceDate:date,
          lines:[{orderLineId:amendRace.lines[0].id,quantity:'4'}]}),
      ]);
      assert.equal(raceResults.filter(result => result.status === 'fulfilled').length,1);
      const raceFinal = await orders.findOne(company,amendRace.id);
      assert(Number(raceFinal.lines[0].invoicedQuantity) <= Number(raceFinal.lines[0].baseQuantity));
      // Cancellation and conversion must serialize on the same parent row.
      const race = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'2',unitPrice:'2',taxRate:'0'}]});
      await orders.approve(company,user,race.id);
      const raceLine = kind === 'sales' ? await prisma.salesOrderLine.findFirstOrThrow({where:{orderId:race.id}})
        : await prisma.purchaseOrderLine.findFirstOrThrow({where:{orderId:race.id}});
      const outcomes = await Promise.allSettled([
        orders.cancel(company,user,race.id,'synthetic concurrent cancellation'),
        orders.convertToInvoice(company,branch,user,race.id,{idempotencyKey:'concurrent-cancel-000001',invoiceDate:date,
          lines:[{orderLineId:raceLine.id,quantity:'2'}]}),
      ]);
      assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length,1);
      assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length,1);
    }
    async function waitForBarrier(reached, pending) {
      let timer;
      try {
        await Promise.race([
          reached,
          pending.then(() => { throw new Error('Operation finished before the test barrier'); }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for race barrier')),15000); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    // Seed enough stock for the synthetic sales posting races below.
    const raceStock = await service.create(company,branch,user,{kind:'ADJUSTMENT',documentDate:date,
      toWarehouseId:warehouse,reason:'Synthetic race stock',lines:[{itemId:second.id,quantity:'20',unitCost:'2'}]});
    await service.post(company,user,raceStock.id);
    for (const [kind, orders, invoices, party] of [['sales',sales,si,customer.id],['purchase',purchases,pi,supplier.id]]) {
      const field = kind === 'sales' ? 'customerId' : 'supplierId';
      const model = kind === 'sales' ? prisma.salesInvoice : prisma.purchaseInvoice;
      const linesModel = kind === 'sales' ? prisma.salesOrderLine : prisma.purchaseOrderLine;
      const order = await orders.create(company,branch,user,{[field]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'10',unitPrice:'2',taxRate:'14'},
          {itemId:first.id,quantity:'5',unitPrice:'3',taxRate:'0'}]});
      await orders.approve(company,user,order.id);
      const orderLines = await linesModel.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}});
      const initial = await orders.convertToInvoice(company,branch,user,order.id,{idempotencyKey:'amend-original-request-01',invoiceDate:date,
        lines:[{orderLineId:orderLines[0].id,quantity:'4'}]});
      await orders.convertToInvoice(company,branch,user,order.id,{idempotencyKey:'amend-other-request-0001',invoiceDate:date,
        lines:[{orderLineId:orderLines[1].id,quantity:'2'}]});
      const old = await model.findUniqueOrThrow({where:{id:initial.invoice.id},include:{lines:true}});
      // Simulate a later order edit: the existing invoice keeps its own agreed
      // price and tax snapshot when its quantity is amended.
      await linesModel.update({where:{id:orderLines[0].id},data:{unitPrice:'9',taxRate:'0'}});
      const request = {expectedUpdatedAt:old.updatedAt.toISOString(),idempotencyKey:'amend-request-00000001',
        lines:[{orderLineId:orderLines[0].id,quantity:'6'},{orderLineId:orderLines[1].id,quantity:'3'}]};
      const failureAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_invoices` && input.action === 'AMEND_ORDER_ALLOCATION') throw new Error('injected amendment audit failure');
        return failureAudit(input,tx);
      };
      try { await assert.rejects(invoices.updateOrderAllocation(company,branch,user,initial.invoice.id,request),/injected amendment audit failure/); }
      finally { audit.recordRequired = failureAudit; }
      assert.equal((await model.findUniqueOrThrow({where:{id:initial.invoice.id},include:{lines:true}})).lines.length,1);
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:orderLines[0].id}})).invoicedQuantity.toFixed(4),'4.0000');
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:orderLines[1].id}})).invoicedQuantity.toFixed(4),'2.0000');
      const amended = await Promise.all([invoices.updateOrderAllocation(company,branch,user,initial.invoice.id,request),
        invoices.updateOrderAllocation(company,branch,user,initial.invoice.id,request)]);
      assert.equal(amended[0].id,initial.invoice.id);
      assert.equal(amended[1].id,initial.invoice.id);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_invoices`,entityId:initial.invoice.id,action:'AMEND_ORDER_ALLOCATION'}}),1);
      const saved = await model.findUniqueOrThrow({where:{id:initial.invoice.id},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      assert.equal(saved.lines.length,2);
      assert.equal(saved.lines[0].quantity.toFixed(4),'6.0000');
      assert.equal(saved.lines[0].unitPrice.toFixed(4),'2.0000');
      assert.equal(saved.lines[0].taxAmount.toFixed(4),'1.6800');
      assert.equal(saved.lines[1].orderLineId,orderLines[1].id);
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:orderLines[0].id}})).invoicedQuantity.toFixed(4),'6.0000');
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:orderLines[1].id}})).invoicedQuantity.toFixed(4),'5.0000');
      await assert.rejects(invoices.updateOrderAllocation(company,branch,user,initial.invoice.id,{...request,
        lines:[{orderLineId:orderLines[0].id,quantity:'5'}]}),/different amendment/);
      await assert.rejects(invoices.updateOrderAllocation(company,branch,user,initial.invoice.id,{...request,
        idempotencyKey:'different-amendment-001',lines:[{orderLineId:orderLines[0].id,quantity:'5'}]}),/changed; reload/);
      assert.equal((await orders.convertToInvoice(company,branch,user,order.id,{idempotencyKey:'amend-original-request-01',invoiceDate:date,
        lines:[{orderLineId:orderLines[0].id,quantity:'4'}]})).invoice.id,initial.invoice.id);
      await invoices.cancelDraft(company,branch,user,initial.invoice.id);
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:orderLines[0].id}})).invoicedQuantity.toFixed(4),'0.0000');
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:orderLines[1].id}})).invoicedQuantity.toFixed(4),'2.0000');

      const raceOrder = await orders.create(company,branch,user,{[field]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'5',unitPrice:'2',taxRate:'0'}]});
      await orders.approve(company,user,raceOrder.id);
      const raceLine = await linesModel.findFirstOrThrow({where:{orderId:raceOrder.id}});
      const raceInvoice = await orders.convertToInvoice(company,branch,user,raceOrder.id,
        {idempotencyKey:'amend-cancel-original-1',invoiceDate:date,lines:[{orderLineId:raceLine.id,quantity:'2'}]});
      const current = await model.findUniqueOrThrow({where:{id:raceInvoice.invoice.id}});
      const change = {expectedUpdatedAt:current.updatedAt.toISOString(),idempotencyKey:'amend-cancel-change-001',
        lines:[{orderLineId:raceLine.id,quantity:'4'}]};
      // Pause a real cancellation after it has read its old invoice lines.
      // Commit the amendment in another transaction before cancellation
      // acquires the order lock; it must then reload the allocations.
      let cancelRead, resumeCancel;
      const cancelReadBarrier = new Promise(resolve => { cancelRead = resolve; });
      const resumeCancelBarrier = new Promise(resolve => { resumeCancel = resolve; });
      const invoiceModelName = kind === 'sales' ? 'salesInvoice' : 'purchaseInvoice';
      let paused = false;
      const cancelPrisma = new Proxy(prisma,{get(target,key) {
        if (key === '$transaction') return (work, options) => target.$transaction(async realTx => {
          const realModel = realTx[invoiceModelName];
          const wrappedModel = new Proxy(realModel,{get(modelTarget, modelKey) {
            const value = modelTarget[modelKey];
            if (modelKey === 'findFirst') return async (...args) => {
              const found = await value.apply(modelTarget,args);
              if (!paused) { paused=true; cancelRead(); await resumeCancelBarrier; }
              return found;
            };
            return typeof value === 'function' ? value.bind(modelTarget) : value;
          }});
          const wrappedTx = new Proxy(realTx,{get(txTarget, txKey) {
            if (txKey === invoiceModelName) return wrappedModel;
            const value = txTarget[txKey];
            return typeof value === 'function' ? value.bind(txTarget) : value;
          }});
          return work(wrappedTx);
        },options);
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const delayedCancel = kind === 'sales'
        ? new SalesInvoicesService(cancelPrisma,numbers,posting,map,settings,warehouses,prices,audit,batches,ledger)
        : new PurchaseInvoicesService(cancelPrisma,numbers,posting,map,settings,warehouses,ledger,prices,audit);
      const pendingCancel = delayedCancel.cancelDraft(company,branch,user,raceInvoice.invoice.id);
      try {
        await waitForBarrier(cancelReadBarrier,pendingCancel);
        await invoices.updateOrderAllocation(company,branch,user,raceInvoice.invoice.id,change);
      } finally { resumeCancel(); }
      await pendingCancel;
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:raceLine.id}})).invoicedQuantity.toFixed(4),'0.0000');
      assert.ok((await model.findUniqueOrThrow({where:{id:raceInvoice.invoice.id}})).deletedAt);
      assert.equal(await prisma.stockMovement.count({where:{companyId:company,referenceId:raceInvoice.invoice.id}}),0);

      const postOrder = await orders.create(company,branch,user,{[field]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'5',unitPrice:'2',taxRate:'0'}]});
      await orders.approve(company,user,postOrder.id);
      const postLine = await linesModel.findFirstOrThrow({where:{orderId:postOrder.id}});
      const postInvoice = await orders.convertToInvoice(company,branch,user,postOrder.id,
        {idempotencyKey:'amend-post-original-001',invoiceDate:date,lines:[{orderLineId:postLine.id,quantity:'2'}]});
      const postBefore = await model.findUniqueOrThrow({where:{id:postInvoice.invoice.id}});
      const postAttempts = await Promise.allSettled([
        invoices.post(company,user,postInvoice.invoice.id),
        invoices.updateOrderAllocation(company,branch,user,postInvoice.invoice.id,{expectedUpdatedAt:postBefore.updatedAt.toISOString(),
          idempotencyKey:'amend-post-change-0001',lines:[{orderLineId:postLine.id,quantity:'4'}]}),
      ]);
      assert.equal(postAttempts[0].status,'fulfilled');
      const posted = await model.findUniqueOrThrow({where:{id:postInvoice.invoice.id},include:{lines:true}});
      assert.equal(posted.status,'POSTED');
      const moves = await prisma.stockMovement.findMany({where:{companyId:company,referenceId:postInvoice.invoice.id}});
      assert.equal(moves.length,1);
      assert.equal(moves[0].quantity.toFixed(4),posted.lines[0].quantity.toFixed(4));
      assert.equal((await linesModel.findUniqueOrThrow({where:{id:postLine.id}})).invoicedQuantity.toFixed(4),posted.lines[0].quantity.toFixed(4));
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,sourceId:postInvoice.invoice.id}}),1);
    }
    for (const [kind, orders, invoices, party] of [['sales',sales,si,customer.id],['purchase',purchases,pi,supplier.id]]) {
      const field = kind === 'sales' ? 'customerId' : 'supplierId';
      const model = kind === 'sales' ? 'salesInvoice' : 'purchaseInvoice';
      const orderLineModel = kind === 'sales' ? prisma.salesOrderLine : prisma.purchaseOrderLine;
      const order = await orders.create(company,branch,user,{[field]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'2',unitPrice:'2',taxRate:'0'}]});
      await orders.approve(company,user,order.id);
      const orderLine = await orderLineModel.findFirstOrThrow({where:{orderId:order.id}});
      const convertedRace = await orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'post-cancel-race-000001',invoiceDate:date,lines:[{orderLineId:orderLine.id,quantity:'2'}]});
      const invoiceId = convertedRace.invoice.id;
      const originalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_invoices` && input.action === 'CANCEL_DRAFT') throw new Error('injected cancel audit failure');
        return originalAudit(input, tx);
      };
      try { await assert.rejects(invoices.cancelDraft(company,branch,user,invoiceId),/injected cancel audit failure/); }
      finally { audit.recordRequired = originalAudit; }
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:orderLine.id}})).invoicedQuantity.toFixed(4),'2.0000');
      assert.equal((await prisma[model].findUniqueOrThrow({where:{id:invoiceId}})).deletedAt,null);
      const raced = await Promise.allSettled([invoices.post(company,user,invoiceId),invoices.cancelDraft(company,branch,user,invoiceId)]);
      assert.equal(raced.filter(x => x.status === 'fulfilled').length,1,`${kind}: post/cancel must have one winner`);
      assert.equal(raced.filter(x => x.status === 'rejected').length,1);
      const savedRace = await prisma[model].findUniqueOrThrow({where:{id:invoiceId}});
      const posted = savedRace.status === 'POSTED';
      assert.equal(Boolean(savedRace.deletedAt),!posted);
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:orderLine.id}})).invoicedQuantity.toFixed(4),posted?'2.0000':'0.0000');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company,referenceId:invoiceId}}),posted?1:0);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,sourceId:invoiceId}}),posted?1:0);

      // A failure in the required POST audit must also roll back stock,
      // the journal, and the invoice's status transition.
      const postingFailureDto = {[field]:party,invoiceDate:date,
        lines:[{itemId:second.id,quantity:'1',unitPrice:'2',taxRate:'0'}]};
      const postingFailure = await invoices.create(company,branch,user,postingFailureDto);
      const stockBeforeFailedPost = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:second.id}}});
      const postingAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_invoices` && input.action === 'POST') throw new Error('injected post audit failure');
        return postingAudit(input, tx);
      };
      try { await assert.rejects(invoices.post(company,user,postingFailure.id),/injected post audit failure/); }
      finally { audit.recordRequired = postingAudit; }
      assert.equal((await prisma[model].findUniqueOrThrow({where:{id:postingFailure.id}})).status,'DRAFT');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company,referenceId:postingFailure.id}}),0);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,sourceId:postingFailure.id}}),0);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_invoices`,entityId:postingFailure.id,action:'POST'}}),0);
      const stockAfterFailedPost = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:second.id}}});
      assert.equal(stockAfterFailedPost.quantity.toFixed(4),stockBeforeFailedPost.quantity.toFixed(4));
      assert.equal(stockAfterFailedPost.value.toFixed(4),stockBeforeFailedPost.value.toFixed(4));
      await invoices.cancelDraft(company,branch,user,postingFailure.id);

      // Pause a real post just after its first header read, edit the unrelated
      // draft with the production service, then resume. Post must claim first
      // and use the newly committed lines for stock and accounting.
      const dto = {[field]:party,invoiceDate:date,lines:[{itemId:second.id,quantity:'1',unitPrice:'2',taxRate:'0'}]};
      const draft = await invoices.create(company,branch,user,dto);
      let readReached, resumePost;
      const readBarrier = new Promise(resolve => { readReached = resolve; });
      const resumeBarrier = new Promise(resolve => { resumePost = resolve; });
      let intercepted = false;
      const invoiceModel = prisma[model];
      const wrappedModel = new Proxy(invoiceModel,{get(target, key) {
        const original = target[key];
        if (key === 'findFirst') return async (...args) => {
          const result = await original.apply(target,args);
          if (!intercepted && args[0]?.where?.id === draft.id && args[0]?.select?.status) {
            intercepted = true; readReached(); await resumeBarrier;
          }
          return result;
        };
        return typeof original === 'function' ? original.bind(target) : original;
      }});
      const wrappedPrisma = new Proxy(prisma,{get(target,key) {
        if (key === model) return wrappedModel;
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const instrumented = kind === 'sales'
        ? new SalesInvoicesService(wrappedPrisma,numbers,posting,map,settings,warehouses,prices,audit,batches,ledger)
        : new PurchaseInvoicesService(wrappedPrisma,numbers,posting,map,settings,warehouses,ledger,prices,audit);
      const pendingPost = instrumented.post(company,user,draft.id);
      try {
        await waitForBarrier(readBarrier,pendingPost);
        await invoices.updateDraft(company,branch,user,draft.id,{...dto,
          lines:[{itemId:second.id,quantity:'3',unitPrice:'2',taxRate:'0'}]});
      } finally { resumePost(); }
      await pendingPost;
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${kind}_invoices`,entityId:draft.id,action:'POST'}}),1);
      const movements = await prisma.stockMovement.findMany({where:{companyId:company,referenceId:draft.id}});
      assert.equal(movements.length,1);
      assert.equal(movements[0].quantity.toFixed(4),'3.0000');
      const postedInvoice = await prisma[model].findUniqueOrThrow({where:{id:draft.id}});
      assert.equal(postedInvoice.totalAmount.toFixed(4),'6.0000');
      const postedJournal = await prisma.journalEntry.findUniqueOrThrow({where:{id:postedInvoice.journalEntryId}});
      assert.equal(postedJournal.totalDebit.toFixed(4),postedJournal.totalCredit.toFixed(4));

      // A draft edit prepared before cancellation must re-check deletedAt
      // while acquiring its row lock, not rewrite a cancelled document.
      const cancelTarget = await invoices.create(company,branch,user,dto);
      let editReached, resumeEdit;
      const editBarrier = new Promise(resolve => { editReached = resolve; });
      const resumeEditBarrier = new Promise(resolve => { resumeEdit = resolve; });
      const editPrisma = new Proxy(prisma,{get(target,key) {
        if (key === '$transaction') return async (...args) => {
          editReached(); await resumeEditBarrier;
          return target.$transaction(...args);
        };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const delayedEditor = kind === 'sales'
        ? new SalesInvoicesService(editPrisma,numbers,posting,map,settings,warehouses,prices,audit,batches,ledger)
        : new PurchaseInvoicesService(editPrisma,numbers,posting,map,settings,warehouses,ledger,prices,audit);
      const pendingEdit = delayedEditor.updateDraft(company,branch,user,cancelTarget.id,{...dto,
        lines:[{itemId:second.id,quantity:'3',unitPrice:'2',taxRate:'0'}]});
      try {
        await waitForBarrier(editBarrier,pendingEdit);
        await invoices.cancelDraft(company,branch,user,cancelTarget.id);
      } finally { resumeEdit(); }
      await assert.rejects(pendingEdit,/posted or changed/);
      const cancelled = await prisma[model].findUniqueOrThrow({where:{id:cancelTarget.id},include:{lines:true}});
      assert.ok(cancelled.deletedAt);
      assert.equal(cancelled.lines[0].quantity.toFixed(4),'1.0000');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company,referenceId:cancelTarget.id}}),0);
    }
    console.log('PASS: real Prisma/PostgreSQL post/edit stale-read, edit/cancel, post/cancel, cancel audit rollback and stock/journal invariants for sales and purchases.');
    console.log('PASS: PostgreSQL + Prisma order conversion full/partial, historical values, audit rollback, retry/competition, post/reverse, draft cancel and order-cancel race. No HTTP, Flutter or installed Windows test.');
  } finally {
    await prisma.$disconnect();
    await sql.end();
  }
})().catch(error => {
  // Don't print database URLs or generated fixture data in CI logs.
  console.error(String(error.stack || error).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE URL REDACTED]'));
  process.exitCode = 1;
});
