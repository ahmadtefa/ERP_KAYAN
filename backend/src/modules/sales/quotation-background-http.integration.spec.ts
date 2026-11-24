import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PDFDocument, rgb } from 'pdf-lib';
import { writeFileSync } from 'fs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { DocumentNumberService } from '../accounting/document-number.service';
import { ProblemDetailsFilter } from '../../common/filters/problem-details.filter';
import { validationExceptionFactory } from '../../common/validation/field-errors';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationBackgroundsController } from './quotation-backgrounds.controller';
import { QuotationBackgroundsService } from './quotation-backgrounds.service';
import { PdfService } from '../export/pdf.service';

const CO='11111111-1111-4111-8111-111111111111';
const USER='22222222-2222-4222-8222-222222222222';
const BR='33333333-3333-4333-8333-333333333333';
const CUSTOMER='44444444-4444-4444-8444-444444444444';
const ready=!!process.env.DATABASE_URL && (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');
jest.setTimeout(180_000);
(ready ? describe : describe.skip)('quotation upload/save/reopen/print/download (real PG, pipe/filter/browser)',()=>{
 let app:INestApplication;let p:PrismaService;let base:string;
 const call=async(method:string,path:string,body?:unknown)=>fetch(base+'/api/v1'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 beforeAll(async()=>{
  @Module({controllers:[QuotationsController,QuotationBackgroundsController],providers:[
   PrismaService,AuditService,DocumentNumberService,PdfService,
   {provide:CompanySettingsService,useFactory:(p:PrismaService,a:AuditService)=>new CompanySettingsService(p,a),inject:[PrismaService,AuditService]},
   {provide:QuotationBackgroundsService,useFactory:(p:PrismaService)=>new QuotationBackgroundsService(p),inject:[PrismaService]},
   {provide:QuotationsService,useFactory:(p:PrismaService,n:DocumentNumberService,s:CompanySettingsService,a:AuditService,b:QuotationBackgroundsService)=>new QuotationsService(p,n,s,{} as never,a,b),inject:[PrismaService,DocumentNumberService,CompanySettingsService,AuditService,QuotationBackgroundsService]},
  ]}) class M {}
  app=await NestFactory.create(M,{logger:false});app.setGlobalPrefix('api/v1');
  // Scope is document transport/composition, not auth. Existing auth guards
  // have separate tests; this isolated controller test injects a fixture user.
  app.use((req:any,_res:any,next:()=>void)=>{req.user={companyId:CO,userId:USER,branchId:BR,isSuperAdmin:true};next();});
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,exceptionFactory:validationExceptionFactory}));app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(0,'127.0.0.1');base=await app.getUrl();p=app.get(PrismaService);
  await p.$executeRawUnsafe('TRUNCATE companies CASCADE');
  await p.$executeRawUnsafe(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES('${CO}','BG','Background Co','شركة تجريبية',now())`);
  await p.$executeRawUnsafe(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES('${BR}','${CO}','B','Branch','فرع',now())`);
  await p.$executeRawUnsafe(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES('${USER}','${CO}','bg','Test','تجريبي','x',now())`);
  await p.$executeRawUnsafe(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES('${CUSTOMER}','${CO}','C','Customer','عميل',now())`);
 });
 afterAll(async()=>{await app?.close();});
 it('retains background design through reopen and uses same composed PDF for print and download',async()=>{
  const sheet=await PDFDocument.create();const pg=sheet.addPage([595.28,841.89]);
  pg.drawRectangle({x:0,y:0,width:32,height:841.89,color:rgb(0.05,0.6,0.35)});
  pg.drawText('UPLOADED LETTERHEAD - SYNTHETIC',{x:70,y:790,size:16});
  const uploaded=await call('POST','/sales/quotation-backgrounds',{name:'synthetic-letterhead.pdf',dataBase64:Buffer.from(await sheet.save()).toString('base64')});
  expect(uploaded.status).toBe(201);const bg:any=await uploaded.json();expect(bg.id).toBeTruthy();
  const dto={quotationDate:'2026-11-24',customerId:CUSTOMER,design:{backgroundId:bg.id,backgroundName:bg.name,hideHeader:true,hideFooter:true},tables:[{title:'Synthetic section',lines:[{description:'Synthetic service',quantity:'2',unitPrice:'125'}]}]};
  const created=await call('POST','/sales/quotations',dto);expect(created.status).toBe(201);const q:any=await created.json();
  const reopened=await call('GET',`/sales/quotations/${q.id}`);const detail:any=await reopened.json();
  expect(detail.design).toEqual(dto.design);
  const saved=await call('PUT',`/sales/quotations/${q.id}`,{...dto,design:detail.design,notes:'After reopening'});expect(saved.status).toBe(200);
  const raw=await p.quotation.findUniqueOrThrow({where:{id:q.id}});expect(raw.design).toEqual(dto.design);
  for(const route of ['print?lang=ar&auto=1','pdf?lang=ar']){
   const r=await call('GET',`/sales/quotations/${q.id}/${route}`);if(r.status!==200)throw new Error(await r.text());expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('application/pdf');
   const bytes=Buffer.from(await r.arrayBuffer());expect(bytes.subarray(0,4).toString()).toBe('%PDF');
   expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
   if(route.startsWith('print'))expect(r.headers.get('content-disposition')).toContain('inline');
   if(process.env.KAYAN_BACKGROUND_PROOF_DIR)writeFileSync(`${process.env.KAYAN_BACKGROUND_PROOF_DIR}/quotation-${route.startsWith('print')?'print':'download'}.pdf`,bytes);
  }
  // Clearing a chosen background must remain an explicit supported edit.
  const cleared=await call('PUT',`/sales/quotations/${q.id}`,{...dto,design:{hideHeader:true,hideFooter:true}});expect(cleared.status).toBe(200);
  const noBg:any=await (await call('GET',`/sales/quotations/${q.id}`)).json();expect(noBg.design.backgroundId).toBeUndefined();
  const plain=await call('GET',`/sales/quotations/${q.id}/print?auto=1`);expect(plain.headers.get('content-type')).toContain('text/html');expect(await plain.text()).toContain('window.print()');
 });
});
