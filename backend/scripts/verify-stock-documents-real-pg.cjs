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
const { StockDocumentsService } = require('../src/modules/inventory/stock-documents.service');
const { ItemsService } = require('../src/modules/inventory/items.service');
const { DocumentsService } = require('../src/modules/export/documents.service');
const { ChartOfAccountsService } = require('../src/modules/accounting/chart-of-accounts.service');
const { StockService } = require('../src/modules/inventory/stock.service');
const { FinancialStatementsService } = require('../src/modules/reports/financial-statements.service');
const { PriceListsService } = require('../src/modules/sales/price-lists.service');
const { SalesOrdersService } = require('../src/modules/sales/sales-orders.service');
const { PurchaseOrdersService } = require('../src/modules/purchases/purchase-orders.service');
const { SalesInvoicesService } = require('../src/modules/sales/sales-invoices.service');
const { PurchaseInvoicesService } = require('../src/modules/purchases/purchase-invoices.service');
const { ProfilePhotoService } = require('../src/modules/auth/profile-photo.service');
const { normalizeLogo } = require('../src/modules/company/company.service');
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
    const costCenters = new CostCentersService(prisma, audit);
    const numbers = new DocumentNumberService();
    const periods = new FiscalPeriodsService(prisma, audit);
    const service = new StockDocumentsService(prisma, numbers,
      new PostingService(numbers, periods, costCenters), new AccountMapService(), audit,
      new CompanySettingsService(prisma, audit), new WarehouseService(prisma, audit), costCenters);
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
    console.log('PASS: PostgreSQL application period create races, overlap edits, audit rollback and period/year close competition. Draft creation and direct SQL range changes remain outside this test.');


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
        documentDate:date,toWarehouseId:secondWarehouse,reason:'Synthetic unit',counterpartyName:'Synthetic party',
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
        service.audit,service.settings,service.warehouses,service.costCenters);
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

    const editableIssue = await service.create(company,branch,user,{idempotencyKey:'editable-issue-create-0001',kind:'ADJUSTMENT',
      voucherKind:'ISSUE',documentDate:date,toWarehouseId:secondWarehouse,reason:'Issue',counterpartyName:'Synthetic department',
      lines:[{itemId:item,quantity:'-1',unitCost:'7'}]},true);
    const issueEdit = {idempotencyKey:'editable-issue-change-0001',expectedVersion:0,documentDate:date,
      toWarehouseId:secondWarehouse,reason:'Issue revised',counterpartyName:'Synthetic department',
      lines:[{id:editableIssue.lines[0].id,itemId:item,quantity:'-2',unitCost:'999'}]};
    const redactedIssue = await service.updateVoucher(company,branch,user,editableIssue.id,issueEdit,false);
    assert.equal(redactedIssue.lines[0].unitCost,null);
    assert.equal((await service.findOne(company,editableIssue.id,true)).lines[0].unitCost,'7.0000');
    const anotherBranch = '70000000-0000-4000-8000-000000000009';
    const anotherWarehouse = '70000000-0000-4000-8000-000000000010';
    await prisma.branch.create({data:{id:anotherBranch,companyId:company,code:'OTHER-SYN',nameEn:'Other branch',nameAr:'فرع آخر'}});
    await prisma.warehouse.create({data:{id:anotherWarehouse,companyId:company,branchId:anotherBranch,code:'OTHER-SYN',nameEn:'Other warehouse',nameAr:'مخزن آخر'}});
    const otherVoucher = await service.create(company,anotherBranch,user,{idempotencyKey:'voucher-other-branch-0001',kind:'ADJUSTMENT',
      voucherKind:'ISSUE',documentDate:date,toWarehouseId:anotherWarehouse,reason:'Other branch',counterpartyName:'Synthetic party',
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
    const si = new SalesInvoicesService(prisma,numbers,posting,map,settings,warehouses,prices,audit);
    const pi = new PurchaseInvoicesService(prisma,numbers,posting,map,settings,warehouses,prices,audit);
    const sales = new SalesOrdersService(prisma,numbers,settings,prices,si,audit);
    const purchases = new PurchaseOrdersService(prisma,numbers,settings,prices,pi,audit);
    // Explicitly cleared, zero, entered and omitted taxes on both order and
    // invoice services. Historical snapshots must survive subsequent changes
    // to the item's tax and the company default, on real Prisma/PostgreSQL.
    // Item creation and updates distinguish explicit blank/null zero from
    // omitted inherited tax; historical invoice/order lines remain snapshots.
    const itemService = new ItemsService(prisma,audit,service.accounts,service.posting,service.warehouses);
    for (const [suffix,rate,expected] of [['EMPTY','','0.0000'],['NULL',null,'0.0000'],['SPACE','   ','0.0000'],['EXPLICIT','7','7.0000'],['OMIT',undefined,null]]) {
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
      {itemId:taxItem.id,quantity:'1',unitPrice:'100'},
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
    assert.equal((await itemService.update(company,user,taxItem.id,{taxRate:''},true)).taxRate,'0.0000');
    await prisma.companySetting.update({where:{companyId:company},data:{taxRate:'3'}});
    for (const snapshot of snapshots) {
      const order=await snapshot.orderModel.findUniqueOrThrow({where:{id:snapshot.orderId},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      const invoice=await snapshot.invoiceModel.findUniqueOrThrow({where:{id:snapshot.invoiceId},include:{lines:{orderBy:{lineNumber:'asc'}}}});
      for (const document of [order,invoice]) {
        assert.deepEqual(document.lines.map(line => line.taxRate.toFixed(4)),['0.0000','0.0000','7.0000','14.0000'],snapshot.kind);
        assert.equal(document.taxAmount.toFixed(4),'21.0000');
        assert.equal(document.totalAmount.toFixed(4),'421.0000');
      }
    }
    await prisma.companySetting.update({where:{companyId:company},data:{taxRate:'14'}});
    console.log('PASS: real PG tax empty, zero, explicit and inherited rates; historical order and invoice snapshots for both types.');
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
      ['1105','ASSET'],['2103','LIABILITY'],['4101','REVENUE'],['5101','EXPENSE']]) {
      await prisma.account.upsert({where:{companyId_code:{companyId:company,code}},
        create:{companyId:company,code,nameEn:`Synthetic ${code}`,nameAr:`تجريبي ${code}`,type,isPostable:true},
        update:{isActive:true,isPostable:true,deletedAt:null}});
    }
    await assert.rejects(si.updateDraft(company,branch,user,converted.sales.invoiceId,{}),/allocation reconciliation/);
    await assert.rejects(pi.updateDraft(company,branch,user,converted.purchase.invoiceId,{}),/allocation reconciliation/);
    await pi.post(company,user,converted.purchase.invoiceId);
    await si.post(company,user,converted.sales.invoiceId);
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
      await svc.reverse(company,user,target.invoiceId);
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
      const CancelClass = kind === 'sales' ? SalesInvoicesService : PurchaseInvoicesService;
      const delayedCancel = new CancelClass(cancelPrisma,numbers,posting,map,settings,warehouses,prices,audit);
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
      const PostingClass = kind === 'sales' ? SalesInvoicesService : PurchaseInvoicesService;
      const instrumented = new PostingClass(wrappedPrisma,numbers,posting,map,settings,warehouses,prices,audit);
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
      const delayedEditor = new PostingClass(editPrisma,numbers,posting,map,settings,warehouses,prices,audit);
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
