import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

const D = (value:string) => new Prisma.Decimal(value);
let saved = {id:'item',companyId:'company',code:'I-1',nameEn:'Item',nameAr:'صنف',unit:'piece',barcode:null,
  salePrice:D('0'),purchasePrice:D('0'),reorderLevel:D('0'),taxRate:null as Prisma.Decimal | null,
  isStockTracked:true,isActive:true,categoryId:null,notes:null,createdAt:new Date()};
const tx={item:{create:jest.fn(async ({data}:{data:Record<string,unknown>}) => {
  saved={...saved,...data} as typeof saved; return saved;
})},itemUnit:{create:jest.fn()}};
const prisma={item:{findFirst:jest.fn(async ({where}:{where:{id?:string}}) => where.id ? saved : null),
  update:jest.fn(async ({data}:{data:Record<string,unknown>}) => { saved={...saved,...data} as typeof saved; return saved; })},
  $transaction:jest.fn(async (callback:(client:typeof tx)=>Promise<unknown>) => callback(tx))};
const service=new ItemsService(prisma as never,{record:jest.fn()} as never,{} as never,{} as never,{} as never);
@Module({controllers:[ItemsController],providers:[{provide:ItemsService,useValue:service}]}) class Fixture {}

describe('item blank tax HTTP DTO', () => {
  it('accepts explicit blank and null as zero, while omission keeps the existing rate', async () => {
    const app=await NestFactory.create(Fixture,{logger:false});
    app.use((req:{user?:object},_res:unknown,next:()=>void) => {
      req.user={companyId:'company',branchId:'branch',userId:'user',isSuperAdmin:false,
        permissions:['inventory.items.create','inventory.items.update']}; next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    await app.listen(0,'127.0.0.1');
    const port=(app.getHttpServer().address() as {port:number}).port;
    const request=(method:string,path:string,body:object) => fetch(`http://127.0.0.1:${port}/inventory/items${path}`,
      {method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    try {
      const omitted=await request('POST','',{code:'I-2',nameEn:'Item 2',nameAr:'صنف ٢'});
      expect(omitted.status).toBe(201);
      expect((await omitted.json() as {taxRate:string}).taxRate).toBe('0.0000');
      const created=await request('POST','',{code:'I-1',nameEn:'Item',nameAr:'صنف',taxRate:''});
      expect(created.status).toBe(201);
      expect((await created.json() as {taxRate:string}).taxRate).toBe('0.0000');
      let response=await request('PATCH','/item',{taxRate:'7'});
      expect((await response.json() as {taxRate:string}).taxRate).toBe('7.0000');
      response=await request('PATCH','/item',{nameEn:'Updated'});
      expect((await response.json() as {taxRate:string}).taxRate).toBe('7.0000');
      response=await request('PATCH','/item',{taxRate:null});
      expect((await response.json() as {taxRate:string}).taxRate).toBe('0.0000');
    } finally { await app.close(); }
  });
});
