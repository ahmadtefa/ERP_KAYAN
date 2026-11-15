import 'reflect-metadata';

import {
  INestApplication,
  Injectable,
  Module,
  NestMiddleware,
  NestModule,
  MiddlewareConsumer,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { WarehousesController } from './warehouses.controller';

/**
 * Who may rearrange the shelves - proved over real HTTP.
 *
 * Reading a warehouse's balance and renaming it are different privileges, and
 * the difference has to be enforced by the server: a screen that hides a
 * button is a convenience, not a control. This file starts a real Nest
 * application with the real controller, the real `@RequirePermissions`
 * metadata and the real guard, then sends actual HTTP requests and reads the
 * actual status codes.
 *
 * Nothing here stubs the permission check: only the warehouse service is a
 * double, because the question is "was the request allowed through", not "what
 * does the database say".
 */

/// The stock keeper the customer asked about: holds the inventory read rights
/// and may adjust stock, but was never granted warehouse management.
const stockKeeper: AuthUser = {
  userId: 'user-stock',
  username: 'stock-keeper',
  companyId: 'company-1',
  branchId: 'branch-1',
  branchIds: ['branch-1'],
  isSuperAdmin: false,
  permissions: [
    'inventory.items.read',
    'inventory.stock.read',
    'inventory.stock.adjust',
    'inventory.warehouses.read',
  ],
};

const warehouseManager: AuthUser = {
  ...stockKeeper,
  userId: 'user-manager',
  username: 'warehouse-manager',
  permissions: [...stockKeeper.permissions, 'inventory.warehouses.manage'],
};

/// Replaces the JWT guard for this application only: the token is not what is
/// under test, and minting one would need a database.
///
/// It has to be middleware, not an interceptor: Nest runs guards before
/// interceptors, so a principal attached in an interceptor reaches the
/// permission check too late and every request is refused for having none -
/// which would make this file pass while proving nothing.
@Injectable()
class PrincipalMiddleware implements NestMiddleware {
  static current: AuthUser = stockKeeper;

  use(request: { user?: AuthUser }, _response: unknown, next: () => void) {
    request.user = PrincipalMiddleware.current;
    next();
  }
}

const warehouseRow = {
  id: 'wh-1',
  code: 'MAIN-1',
  nameEn: 'Main store',
  nameAr: 'المخزن الرئيسي',
  address: null,
  isDefault: true,
  isActive: true,
  branchId: 'branch-1',
  branchCode: 'MAIN',
  branchNameEn: 'Main',
  branchNameAr: 'الرئيسي',
};

/// One double for the whole file. It records every call that reached the
/// service, so a refusal can be shown to have happened *before* any write.
const called: string[] = [];
const stubService = {
      findAll: async () => {
        called.push('findAll');
        return { items: [warehouseRow], total: 1 };
      },
      findOne: async () => {
        called.push('findOne');
        return warehouseRow;
      },
      stock: async () => {
        called.push('stock');
        return { warehouse: warehouseRow, asOf: '2026-11-01', rows: [], totals: { value: '0.0000' } };
      },
      balanceReport: async () => {
        called.push('balanceReport');
        return { asOf: '2026-11-01', rows: [], itemTotals: [], warehouseTotals: [], totals: { rows: 0, value: null } };
      },
      create: async () => {
        called.push('create');
        return warehouseRow;
      },
      update: async () => {
        called.push('update');
        return warehouseRow;
      },
      deactivate: async () => {
        called.push('deactivate');
        return warehouseRow;
      },
  reactivate: async () => {
    called.push('reactivate');
    return warehouseRow;
  },
};

@Module({
  controllers: [WarehousesController],
  providers: [
    { provide: WarehouseService, useValue: stubService },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    PrincipalMiddleware,
  ],
})
class WarehousesHttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Applied by controller rather than by a wildcard path, so the route
    // pattern rules of the HTTP adapter cannot silently match nothing.
    consumer.apply(PrincipalMiddleware).forRoutes(WarehousesController);
  }
}

describe('warehouse management over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;

  const send = (method: string, path: string) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    });

  beforeAll(async () => {
    app = await NestFactory.create(WarehousesHttpModule, { logger: false });
    // Port 0 asks the operating system for a free port: the test never
    // collides with anything else on the machine running it.
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    called.length = 0;
  });

  it('lets the stock keeper read the warehouses and their balances', async () => {
    PrincipalMiddleware.current = stockKeeper;

    expect((await send('GET', '/inventory/warehouses')).status).toBe(200);
    expect((await send('GET', '/inventory/warehouses/balance')).status).toBe(200);
    expect((await send('GET', '/inventory/warehouses/wh-1')).status).toBe(200);
    expect((await send('GET', '/inventory/warehouses/wh-1/stock')).status).toBe(200);
  });

  it('refuses every management route with 403 for a user without the permission', async () => {
    PrincipalMiddleware.current = stockKeeper;

    const attempts: Array<[string, string]> = [
      ['POST', '/inventory/warehouses'],
      ['PATCH', '/inventory/warehouses/wh-1'],
      ['POST', '/inventory/warehouses/wh-1/deactivate'],
      ['POST', '/inventory/warehouses/wh-1/reactivate'],
    ];

    for (const [method, path] of attempts) {
      const response = await send(method, path);
      expect({ method, path, status: response.status }).toEqual({
        method,
        path,
        status: 403,
      });
    }

    // The refusals happened before any write was attempted.
    expect(called).toEqual([]);
  });

  it('says which permission is missing, in Arabic and English', async () => {
    PrincipalMiddleware.current = stockKeeper;

    const response = await send('POST', '/inventory/warehouses');
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain('inventory.warehouses.manage');
    expect(body.message).toContain('ليس لديك صلاحية');
  });

  it('lets a manager through to the same routes', async () => {
    PrincipalMiddleware.current = warehouseManager;

    expect((await send('POST', '/inventory/warehouses')).status).toBe(201);
    expect((await send('PATCH', '/inventory/warehouses/wh-1')).status).toBe(200);
    expect((await send('POST', '/inventory/warehouses/wh-1/deactivate')).status).toBe(201);
    expect((await send('POST', '/inventory/warehouses/wh-1/reactivate')).status).toBe(201);

    expect(called).toEqual(['create', 'update', 'deactivate', 'reactivate']);
  });

  it('does not let the manage permission substitute for the read one', async () => {
    PrincipalMiddleware.current = {
      ...warehouseManager,
      permissions: ['inventory.warehouses.manage'],
    };

    expect((await send('GET', '/inventory/warehouses')).status).toBe(403);
  });
});
