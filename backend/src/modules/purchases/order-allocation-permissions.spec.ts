import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PurchaseInvoicesController } from './purchase-invoices.controller';
import { PurchaseInvoicesService } from './purchase-invoices.service';

const service = { updateOrderAllocation: jest.fn().mockResolvedValue({ id: 'invoice' }) };
@Module({ controllers: [PurchaseInvoicesController], providers: [{ provide: PurchaseInvoicesService, useValue: service }] })
class TestModule {}

describe('purchase order allocation HTTP permissions', () => {
  it('requires both catalogued purchase permissions and allows a properly scoped user', async () => {
    const app = await NestFactory.create(TestModule, { logger: false });
    app.use((req: { headers: Record<string, string>; user?: object }, _res: unknown, next: () => void) => {
      req.user = { userId: 'user', companyId: 'company', branchId: 'branch', isSuperAdmin: false,
        permissions: (req.headers['x-permissions'] ?? '').split(',').filter(Boolean) };
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    const call = (permissions: string) => fetch(`http://127.0.0.1:${port}/purchases/invoices/invoice/order-allocation`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-permissions': permissions }, body: '{}',
    });
    try {
      service.updateOrderAllocation.mockClear();
      expect((await call('purchases.orders.read')).status).toBe(403);
      expect((await call('purchases.invoices.create')).status).toBe(403);
      expect((await call('purchase.orders.read,purchase.invoices.create')).status).toBe(403);
      expect(service.updateOrderAllocation).not.toHaveBeenCalled();
      expect((await call('purchases.orders.read,purchases.invoices.create')).status).toBe(200);
      expect(service.updateOrderAllocation).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
