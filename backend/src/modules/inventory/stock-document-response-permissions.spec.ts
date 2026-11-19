import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { StockDocumentsController } from './stock-documents.controller';
import { StockDocumentsService } from './stock-documents.service';

const calls = { create: jest.fn(), post: jest.fn(), reverse: jest.fn(), findOne: jest.fn() };
for (const [name,fn] of Object.entries(calls)) fn.mockImplementation(async (...args: unknown[]) => ({
  lines: [{ unitCost: args[name === 'findOne' ? 2 : name === 'create' ? 4 : 3] === true ? '11.0000' : null }],
}));
@Module({ controllers:[StockDocumentsController], providers:[{ provide:StockDocumentsService, useValue:calls }] })
class FixtureModule {}

describe('stock document response cost visibility', () => {
  it('passes cost visibility for every HTTP operation, not only reads', async () => {
    const app = await NestFactory.create(FixtureModule, { logger:false });
    app.use((req: { headers: Record<string,string>; user?: object }, _res: unknown, next: () => void) => {
      req.user = { companyId:'company', branchId:'branch', userId:'user', isSuperAdmin:false,
        permissions:['inventory.stock.read','inventory.stock.adjust', ...(req.headers['x-cost'] === 'yes' ? ['inventory.cost.read'] : [])] };
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as {port:number}).port;
    try {
      for (const [method,path] of [['GET','/doc'],['POST',''],['POST','/doc/post'],['POST','/doc/reverse']]) {
        for (const allowed of [false,true]) {
          const response = await fetch(`http://127.0.0.1:${port}/inventory/stock-documents${path}`, {
            method, headers:{'content-type':'application/json','x-cost':allowed ? 'yes' : 'no'},
            ...(method === 'POST' ? {body:'{}'} : {}),
          });
          expect(response.ok).toBe(true);
          expect((await response.json() as {lines:Array<{unitCost:string | null}>}).lines[0].unitCost)
            .toBe(allowed ? '11.0000' : null);
        }
      }
      // Every operation must hand the caller's cost visibility to whatever
      // builds its response. The exact call sequence is scaffolding: approving
      // and posting first re-read the document to decide warehouse access, and
      // that guard read is deliberately cost-blind so a refusal cannot leak a
      // cost. What matters is that each operation is called both ways - once
      // for a caller allowed costs and once for a caller not allowed them - so
      // no route can quietly hard-code either answer.
      const flags = (fn: jest.Mock, costArg: number) =>
        new Set(
          fn.mock.calls
            .map((call) => call[costArg])
            .filter((value) => typeof value === 'boolean'),
        );
      expect(flags(calls.findOne, 2)).toEqual(new Set([true, false]));
      expect(flags(calls.create, 4)).toEqual(new Set([true, false]));
      expect(flags(calls.post, 3)).toEqual(new Set([true, false]));
      expect(flags(calls.reverse, 3)).toEqual(new Set([true, false]));
    } finally { await app.close(); }
  });
});
