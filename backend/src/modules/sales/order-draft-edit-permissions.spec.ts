import { ConflictException, Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProblemDetailsFilter } from '../../common/filters/problem-details.filter';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { PurchaseOrdersController } from '../purchases/purchase-orders.controller';
import { PurchaseOrdersService } from '../purchases/purchase-orders.service';

const sales = { updateDraft: jest.fn().mockResolvedValue({ id:'order' }), amend: jest.fn().mockResolvedValue({id:'order'}) };
const purchases = { updateDraft: jest.fn().mockResolvedValue({ id:'order' }), amend: jest.fn().mockResolvedValue({id:'order'}) };
@Module({ controllers:[SalesOrdersController, PurchaseOrdersController], providers:[
  { provide:SalesOrdersService, useValue:sales }, { provide:PurchaseOrdersService, useValue:purchases },
] }) class FixtureModule {}

describe('draft order edit HTTP permissions', () => {
  it('requires both read and manage in the matching module', async () => {
    const app = await NestFactory.create(FixtureModule, { logger:false });
    app.use((req: { headers: Record<string,string>; user?: object }, _res: unknown, next: () => void) => {
      req.user = { userId:'user', companyId:'company', branchId:'branch', isSuperAdmin:false,
        permissions:(req.headers['x-permissions'] ?? '').split(',').filter(Boolean) };
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as {port:number}).port;
    try {
      for (const [scope, service] of [['sales',sales],['purchases',purchases]] as const) {
        service.updateDraft.mockClear();
        const call = (permissions:string) => fetch(`http://127.0.0.1:${port}/${scope}/orders/order`,
          {method:'PUT', headers:{'content-type':'application/json','x-permissions':permissions}, body:'{}'});
        expect((await call(`${scope}.orders.read`)).status).toBe(403);
        expect((await call(`${scope}.orders.manage`)).status).toBe(403);
        expect(service.updateDraft).not.toHaveBeenCalled();
        expect((await call(`${scope}.orders.read,${scope}.orders.manage`)).status).toBe(200);
        expect(service.updateDraft).toHaveBeenCalledTimes(1);
        service.updateDraft.mockRejectedValueOnce(new ConflictException({ code:'ORDER_EDIT_STALE', detail:'Order changed' }));
        const stale = await call(`${scope}.orders.read,${scope}.orders.manage`);
        expect(stale.status).toBe(409);
        expect(await stale.json()).toEqual(expect.objectContaining({ code:'ORDER_EDIT_STALE', detail:'Order changed' }));
        const amend = (permissions:string) => fetch(`http://127.0.0.1:${port}/${scope}/orders/order/amend`,
          {method:'PUT', headers:{'content-type':'application/json','x-permissions':permissions}, body:'{}'});
        expect((await amend(`${scope}.orders.read`)).status).toBe(403);
        expect((await amend(`${scope}.orders.manage`)).status).toBe(403);
        expect(service.amend).not.toHaveBeenCalled();
        expect((await amend(`${scope}.orders.read,${scope}.orders.manage`)).status).toBe(200);
        expect(service.amend).toHaveBeenCalledTimes(1);
      }
    } finally { await app.close(); }
  });
});
