import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pglitePrisma } from '../../testing/pglite-adapter';
import { StockTransfersService } from './stock-transfers.service';

const COMPANY='11111111-1111-4111-8111-111111111111';
const BRANCH_A='22222222-2222-4222-8222-222222222222';
const BRANCH_B='22222222-2222-4222-8222-222222222223';
const USER_A='33333333-3333-4333-8333-333333333333';
const USER_B='33333333-3333-4333-8333-333333333334';
const USER_C='33333333-3333-4333-8333-333333333335';
const FROM='44444444-4444-4444-8444-444444444444';
const TO='55555555-5555-4555-8555-555555555555';
const OTHER_WAREHOUSE='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ITEM='66666666-6666-4666-8666-666666666666';
const BASE_UNIT='77777777-7777-4777-8777-777777777777';
const CARTON_UNIT='88888888-8888-4888-8888-888888888888';
const migrationsDir=join(process.cwd(),'prisma','migrations');

async function database() {
  const db=new PGlite();
  for(const dir of readdirSync(migrationsDir,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort()) {
    try { await db.exec(readFileSync(join(migrationsDir,dir,'migration.sql'),'utf8')); } catch(e) { if (!(e instanceof Error) || !e.message.includes('already exists')) throw e; }
  }
  await db.exec(`
    INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES
      ('${COMPANY}','CO','Company','شركة',now());
    INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES
      ('${BRANCH_A}','${COMPANY}','A','A','أ',now()),('${BRANCH_B}','${COMPANY}','B','B','ب',now());
    INSERT INTO warehouses(id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES
      ('${FROM}','${COMPANY}','${BRANCH_A}','FROM','From','من',true,true,now()),
      ('${TO}','${COMPANY}','${BRANCH_B}','TO','To','إلى',true,true,now());
    INSERT INTO items(id,"companyId",code,"nameEn","nameAr",unit,"isStockTracked","requiresBatch","useFefo","salePrice","updatedAt")
      VALUES('${ITEM}','${COMPANY}','I-1','Item','صنف','piece',true,false,true,1,now());
    INSERT INTO item_units(id,"itemId",unit,factor,"isActive","createdAt","updatedAt") VALUES
      ('${BASE_UNIT}','${ITEM}','piece',1,true,now(),now()),
      ('${CARTON_UNIT}','${ITEM}','carton',24,true,now(),now());
  `);
  return db;
}

jest.setTimeout(120_000);
const vmReady=process.execArgv.includes('--experimental-vm-modules')||(process.env.NODE_OPTIONS??'').includes('--experimental-vm-modules');
(vmReady?describe:describe.skip)('staged stock transfer workflow on PostgreSQL-compatible schema',()=>{
  let db:PGlite; let service:StockTransfersService; let posted:string[]; let raised:Array<Record<string,unknown>>; let storedNotifications:Map<string,Record<string,unknown>>; let docsState:Map<string,{status:string;approvedAt?:Date}>;
  beforeEach(async()=>{
    db=await database(); const prisma=pglitePrisma(db); posted=[]; raised=[]; storedNotifications=new Map(); docsState=new Map();
    const docs={
      create:jest.fn(async()=>{const id=randomUUID();docsState.set(id,{status:'DRAFT'});return {id,lines:[{itemId:ITEM,unitCost:'4.2500'}]};}),
      findOne:jest.fn(async (...args:string[])=>docsState.get(args[1])??{status:'DRAFT'}),
      approve:jest.fn(async (...args:string[])=>{const id=args[2];const d=docsState.get(id)!;d.approvedAt=new Date();return d;}),
      post:jest.fn(async (...args:string[])=>{const id=args[2];posted.push(id);docsState.get(id)!.status='POSTED';return {status:'POSTED'};}),
    };
    service=new StockTransfersService(
      prisma as never,
      docs as never,
      {record:async()=>undefined} as never,
      {
        raise:async(input:Record<string,unknown>)=>{
          raised.push(input);
          const dedupe=String(input.dedupe);
          const existing=storedNotifications.get(dedupe);
          storedNotifications.set(dedupe,{...existing,...input,status:existing?.status==='CLOSED'?'OPEN':existing?.status??'OPEN'});
          return {id:`notification-${storedNotifications.size}`};
        },
        resolveEntity:async(_companyId:string,_entityType:string,entityId:string,activeTypes:readonly string[])=>{
          for(const [key,notification] of storedNotifications) {
            if(notification.entityId===entityId&&!activeTypes.includes(String(notification.type))) {
              storedNotifications.set(key,{...notification,status:'CLOSED'});
            }
          }
          return {closed:0};
        },
      } as never,
    );
  });
  afterEach(async()=>db.close());

  it('requests, independently reviews and approves, dispatches to transit, receives partially, and closes after reconciliation',async()=>{
    const row=await service.create(COMPANY,USER_A,{sourceWarehouseId:FROM,destinationWarehouseId:TO,transferDate:'2026-11-21',reason:'Branch replenishment',idempotencyKey:'create-001',lines:[{itemId:ITEM,quantity:'10'}]});
    const created=await service.create(COMPANY,USER_A,{sourceWarehouseId:FROM,destinationWarehouseId:TO,transferDate:'2026-11-21',reason:'Branch replenishment',idempotencyKey:'create-001',lines:[{itemId:ITEM,quantity:'10'}]});
    expect(created.id).toBe(row.id);
    await service.review(COMPANY,USER_B,row.id,'review-001');
    await expect(service.approve(COMPANY,USER_A,row.id,'approve-001')).rejects.toThrow('requester cannot approve');
    await expect(service.approve(COMPANY,USER_B,row.id,'same-reviewer')).rejects.toThrow('reviewer cannot also approve');
    await service.approve(COMPANY,USER_C,row.id,'approve-001');
    const dispatched=await service.dispatch(COMPANY,USER_A,row.id,'dispatch-001',[{lineId:row.lines[0].id,quantity:'10'}]);
    expect(dispatched.status).toBe('DISPATCHED');
    expect(dispatched.lines[0].dispatchedQuantity.toString()).toBe('10');
    expect(posted).toHaveLength(1);
    const receiptTask=[...storedNotifications.values()].find(event=>event.type==='STOCK_TRANSFER_RECEIPT_REQUIRED')!;
    expect(receiptTask.status).toBe('OPEN');
    expect(receiptTask.warehouseId).toBe(TO);
    const received=await service.receive(COMPANY,USER_B,row.id,'receive-001',[{lineId:row.lines[0].id,quantity:'4'}]);
    expect(received.status).toBe('PARTIALLY_RECEIVED');
    expect(received.lines[0].receivedQuantity.toString()).toBe('4');
    expect([...storedNotifications.values()].find(event=>event.type==='STOCK_TRANSFER_RECEIPT_REQUIRED')?.status).toBe('OPEN');
    const settled=await service.settle(COMPANY,USER_B,row.id,'settle-001',[{lineId:row.lines[0].id,returnedQuantity:'6',reason:'Unneeded units returned'}]);
    expect(settled.status).toBe('SETTLED');
    expect(settled.lines[0].returnedQuantity.toString()).toBe('6');
    await service.close(COMPANY,USER_B,row.id,'close-001');
    expect((await service.findOne(COMPANY,row.id)).status).toBe('CLOSED');
    expect(posted).toHaveLength(3);
    expect(raised.map(event=>event.type)).toEqual([
      'STOCK_TRANSFER_REVIEW_REQUIRED',
      'STOCK_TRANSFER_REVIEW_REQUIRED',
      'STOCK_TRANSFER_APPROVAL_REQUIRED',
      'STOCK_TRANSFER_DISPATCH_REQUIRED',
      'STOCK_TRANSFER_RECEIPT_REQUIRED',
      'STOCK_TRANSFER_RECEIPT_REQUIRED',
      'STOCK_TRANSFER_RECEIVED',
      'STOCK_TRANSFER_RECEIVED',
      'STOCK_TRANSFER_CLOSE_REQUIRED',
    ]);
    expect(raised[0].dedupe).toBe(raised[1].dedupe);
    const storedRows = [...storedNotifications.values()];
    expect(storedRows).toHaveLength(6);
    const senderReceipt = storedRows.find(event=>event.type==='STOCK_TRANSFER_RECEIVED')!;
    expect(senderReceipt.warehouseId).toBe(FROM);
    expect(senderReceipt.branchId).toBe(BRANCH_A);
    expect(senderReceipt.status).toBe('CLOSED');
    const receipt = storedRows.find(event=>event.type==='STOCK_TRANSFER_RECEIPT_REQUIRED')!;
    expect(receipt.warehouseId).toBe(TO);
    expect(receipt.branchId).toBe(BRANCH_B);
    expect(receipt.actionPath).toBe(`/inventory/stock-transfers?transferId=${row.id}`);
    expect(receipt.status).toBe('CLOSED');
    expect(storedRows.filter(event=>event.type==='STOCK_TRANSFER_RECEIPT_REQUIRED')).toHaveLength(1);
    expect(storedRows.every(event=>event.status==='CLOSED')).toBe(true);
    expect(JSON.stringify(storedRows)).not.toMatch(/unitCost|purchasePrice|costOfGoods|inventoryCostTotal/);
  });

  it('continues dispatching after an earlier partial shipment was received, with accurate outstanding tasks',async()=>{
    const row=await service.create(COMPANY,USER_A,{sourceWarehouseId:FROM,destinationWarehouseId:TO,transferDate:'2026-11-21',reason:'Multiple shipments',idempotencyKey:'multi-create',lines:[{itemId:ITEM,quantity:'10'}]});
    const lineId=row.lines[0].id;
    await service.review(COMPANY,USER_B,row.id,'multi-review');
    await service.approve(COMPANY,USER_C,row.id,'multi-approve');
    await service.dispatch(COMPANY,USER_A,row.id,'multi-dispatch-1',[{lineId,quantity:'4'}]);
    const first=await service.receive(COMPANY,USER_B,row.id,'multi-receive-1',[{lineId,quantity:'4'}]);
    expect(first.status).toBe('PARTIALLY_RECEIVED');
    expect([...storedNotifications.values()].find(event=>event.type==='STOCK_TRANSFER_DISPATCH_REQUIRED')?.status).toBe('OPEN');
    expect([...storedNotifications.values()].find(event=>event.type==='STOCK_TRANSFER_RECEIPT_REQUIRED')?.status).toBe('CLOSED');
    const second=await service.dispatch(COMPANY,USER_A,row.id,'multi-dispatch-2');
    expect(second.lines[0].dispatchedQuantity.toString()).toBe('10');
    expect(second.status).toBe('DISPATCHED');
    const received=await service.receive(COMPANY,USER_B,row.id,'multi-receive-2',[{lineId,quantity:'6'}]);
    expect(received.status).toBe('RECEIVED');
    expect(received.lines[0].receivedQuantity.toString()).toBe('10');
    await service.close(COMPANY,USER_C,row.id,'multi-close');
    expect(posted).toHaveLength(4);
  });

  it('keeps a partially dispatched transfer open after all dispatched goods are reconciled',async()=>{
    const row=await service.create(COMPANY,USER_A,{sourceWarehouseId:FROM,destinationWarehouseId:TO,transferDate:'2026-11-21',reason:'Partial shipment shortage',idempotencyKey:'partial-settle-create',lines:[{itemId:ITEM,quantity:'10'}]});
    const lineId=row.lines[0].id;
    await service.review(COMPANY,USER_B,row.id,'partial-settle-review');
    await service.approve(COMPANY,USER_C,row.id,'partial-settle-approve');
    await service.dispatch(COMPANY,USER_A,row.id,'partial-settle-dispatch',[{lineId,quantity:'4'}]);
    await service.receive(COMPANY,USER_B,row.id,'partial-settle-receive',[{lineId,quantity:'3'}]);
    const pending=await service.settle(COMPANY,USER_A,row.id,'partial-settle-writeoff',[{lineId,shortage:'1',reason:'Missing'}]);
    expect(pending.status).toBe('SETTLEMENT_PENDING');
    const settled=await service.approveSettlement(COMPANY,USER_B,row.id);
    expect(settled.status).toBe('PARTIALLY_RECEIVED');
    await expect(service.close(COMPANY,USER_C,row.id,'partial-settle-close')).rejects.toThrow();
    expect([...storedNotifications.values()].find(event=>event.type==='STOCK_TRANSFER_DISPATCH_REQUIRED')?.status).toBe('OPEN');
    const next=await service.dispatch(COMPANY,USER_A,row.id,'partial-settle-next');
    expect(next.lines[0].dispatchedQuantity.toString()).toBe('10');
  });

  it('requires a different approver to post a missing/damaged quantity write-off',async()=>{
    const row=await service.create(COMPANY,USER_A,{sourceWarehouseId:FROM,destinationWarehouseId:TO,transferDate:'2026-11-21',reason:'Transfer with shortage',idempotencyKey:'create-writeoff',lines:[{itemId:ITEM,quantity:'10'}]});
    await service.review(COMPANY,USER_B,row.id,'review-writeoff'); await service.approve(COMPANY,USER_C,row.id,'approve-writeoff');
    await service.dispatch(COMPANY,USER_A,row.id,'dispatch-writeoff');
    await service.receive(COMPANY,USER_B,row.id,'receive-writeoff',[{lineId:row.lines[0].id,quantity:'7'}]);
    const pending=await service.settle(COMPANY,USER_A,row.id,'settle-writeoff',[{lineId:row.lines[0].id,shortage:'2',damage:'1',reason:'Crushed during transit'}]);
    expect(pending.status).toBe('SETTLEMENT_PENDING');
    expect(raised.at(-1)?.type).toBe('STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED');
    expect(raised.at(-1)?.warehouseId).toBe(TO);
    await expect(service.approveSettlement(COMPANY,USER_A,row.id)).rejects.toThrow('cannot approve');
    const settled=await service.approveSettlement(COMPANY,USER_B,row.id);
    expect(settled.status).toBe('SETTLED');
    expect(settled.lines[0].writtenOffQuantity.toString()).toBe('3');
    expect(raised.at(-1)?.type).toBe('STOCK_TRANSFER_CLOSE_REQUIRED');
  });

  it('freezes the entered unit conversion while storing base-unit stock quantity',async()=>{
    const row=await service.create(COMPANY,USER_A,{sourceWarehouseId:FROM,destinationWarehouseId:TO,transferDate:'2026-11-21',reason:'Case pack',idempotencyKey:'unit-001',lines:[{itemId:ITEM,quantity:'2',unitName:'carton'}]});
    expect(row.lines[0].requestedQuantity.toString()).toBe('48');
    expect(row.lines[0].unitName).toBe('carton');
    expect(row.lines[0].unitFactor?.toString()).toBe('24');
    expect(row.lines[0].unitQuantity?.toString()).toBe('2');
  });

  it('rejects cross-company warehouses and refuses idempotency-key payload changes',async()=>{
    await expect(service.create(COMPANY,USER_A,{sourceWarehouseId:FROM,destinationWarehouseId:OTHER_WAREHOUSE,transferDate:'2026-11-21',reason:'No cross-company stock',idempotencyKey:'bad-001',lines:[{itemId:ITEM,quantity:1}]})).rejects.toThrow();
    const input={sourceWarehouseId:FROM,destinationWarehouseId:TO,transferDate:'2026-11-21',reason:'Counted stock',idempotencyKey:'same-001',lines:[{itemId:ITEM,quantity:1}]};
    await service.create(COMPANY,USER_A,input);
    await expect(service.create(COMPANY,USER_A,{...input,lines:[{itemId:ITEM,quantity:2}]})).rejects.toThrow('different transfer request');
  });
});
