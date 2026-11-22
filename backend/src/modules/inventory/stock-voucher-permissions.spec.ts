import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { StockDocumentsController } from './stock-documents.controller';
import { StockDocumentsService } from './stock-documents.service';
// Every voucher route now re-reads the document to decide warehouse access
// before it acts, so the double has to answer findOne with a document that
// names its shelf and its kind. Without it the guard read is what fails, and
// the permission assertions below would be testing a 500 instead of a 403.
const document = {
  id: 'doc',
  kind: 'RECEIPT',
  voucherKind: 'RECEIPT',
  fromWarehouseId: null,
  toWarehouseId: null,
  status: 'DRAFT',
};
const service = {
  findOne: jest.fn().mockResolvedValue(document),
  transitionVoucher: jest.fn().mockResolvedValue({ id: 'document' }),
  updateVoucher: jest.fn().mockResolvedValue({ id: 'document' }),
  create: jest.fn().mockResolvedValue({ id: 'document' }),
  post: jest.fn().mockResolvedValue({ id: 'document' }),
  reverse: jest.fn().mockResolvedValue({ id: 'document' }),
};
@Module({controllers:[StockDocumentsController],providers:[{provide:StockDocumentsService,useValue:service}]}) class Fixture {}
describe('stock voucher workflow HTTP permissions', () => {
  it('requires read and the distinct review or approval privilege', async () => {
    const app = await NestFactory.create(Fixture,{logger:false});
    app.use((req:{headers:Record<string,string>;user?:object},_res:unknown,next:()=>void) => {
      req.user={companyId:'company',branchId:'branch',userId:'user',isSuperAdmin:false,
        permissions:(req.headers['x-permissions'] ?? '').split(',').filter(Boolean)}; next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector())); await app.listen(0,'127.0.0.1');
    const port=(app.getHttpServer().address() as {port:number}).port;
    try {
      const edit = (permissions:string) => fetch(`http://127.0.0.1:${port}/inventory/stock-documents/doc/voucher-draft`,
        {method:'PUT',headers:{'x-permissions':permissions,'content-type':'application/json'},body:'{}'});
      expect((await edit('inventory.stock.read')).status).toBe(403);
      expect((await edit('inventory.stock.adjust')).status).toBe(403);
      expect(service.updateVoucher).not.toHaveBeenCalled();
      expect((await edit('inventory.stock.read,inventory.stock.adjust')).status).toBe(200);
      expect(service.updateVoucher).toHaveBeenCalledWith('company','branch','user','doc',{},false);
      for (const [path,permission,stage] of [['review','inventory.stock.review','REVIEW'],['approve','inventory.stock.approve','APPROVE']]) {
        service.transitionVoucher.mockClear();
        const call=(permissions:string) => fetch(`http://127.0.0.1:${port}/inventory/stock-documents/doc/${path}`,
          {method:'POST',headers:{'x-permissions':permissions,'content-type':'application/json'},body:JSON.stringify({expectedVersion:2})});
        expect((await call('inventory.stock.read')).status).toBe(403);
        expect((await call(permission)).status).toBe(403);
        expect(service.transitionVoucher).not.toHaveBeenCalled();
        const missing = await fetch(`http://127.0.0.1:${port}/inventory/stock-documents/doc/${path}`,
          {method:'POST',headers:{'x-permissions':`inventory.stock.read,${permission}`,'content-type':'application/json'},body:'{}'});
        expect(missing.status).toBe(400);
        expect(service.transitionVoucher).not.toHaveBeenCalled();
        expect((await call(`inventory.stock.read,${permission}`)).status).toBe(201);
        expect(service.transitionVoucher).toHaveBeenCalledWith('company','branch','user','doc',stage,false,2);
      }
      service.updateVoucher.mockClear();
      const storekeeperEdit = (permissions:string) => fetch(`http://127.0.0.1:${port}/inventory/stock-documents/vouchers/doc/draft`,
        {method:'PUT',headers:{'x-permissions':permissions,'content-type':'application/json'},body:'{}'});
      expect((await storekeeperEdit('inventory.stock.read')).status).toBe(403);
      expect(service.updateVoucher).not.toHaveBeenCalled();
      expect((await storekeeperEdit('inventory.stock.read,inventory.stock.voucher.create')).status).toBe(200);
      expect(service.updateVoucher).toHaveBeenCalledWith('company','branch','user','doc',{},false);

      service.create.mockClear();
      const create = (permissions:string) => fetch(`http://127.0.0.1:${port}/inventory/stock-documents/vouchers`,
        {method:'POST',headers:{'x-permissions':permissions,'content-type':'application/json'},body:JSON.stringify({voucherKind:'ISSUE'})});
      expect((await create('inventory.stock.read')).status).toBe(403);
      expect(service.create).not.toHaveBeenCalled();
      expect((await create('inventory.stock.voucher.create')).status).toBe(201);
      expect(service.create).toHaveBeenCalledWith('company','branch','user',
        {voucherKind:'ISSUE',kind:'ADJUSTMENT'},false);

      for (const action of ['post','reverse'] as const) {
        const method = service[action];
        method.mockClear();
        const call = (permissions:string) => fetch(`http://127.0.0.1:${port}/inventory/stock-documents/vouchers/doc/${action}`,
          {method:'POST',headers:{'x-permissions':permissions,'content-type':'application/json'},body:'{}'});
        expect((await call('inventory.stock.read')).status).toBe(403);
        expect(method).not.toHaveBeenCalled();
        expect((await call('inventory.stock.voucher.post')).status).toBe(201);
        expect(method).toHaveBeenCalled();
      }
    } finally { await app.close(); }
  });
});
