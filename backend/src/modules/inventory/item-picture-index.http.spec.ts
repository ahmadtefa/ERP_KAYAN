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
import { ItemImageController, ItemPictureIndexController } from './item-image.controller';
import { ItemImageService } from './item-image.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

/**
 * Where the catalogue's picture index actually lives.
 *
 * `ItemsController` declares `GET :id`, so any literal sibling path registered
 * after it is never reached: Nest matches routes in registration order, and
 * `with-picture` would be read as an item id. This file starts a real Nest
 * application containing both controllers *in the module's order* and proves
 * over real HTTP that the literal route answers and that the wildcard does not
 * swallow it. It is a regression test: before the ordering fix, this request
 * returned 500 from the item lookup.
 *
 * Nothing here touches a database; only the two services are doubles, because
 * the question is which controller answered, not what the tables hold.
 */

const reader: AuthUser = {
  userId: 'user-reader',
  username: 'reader',
  companyId: 'company-1',
  branchId: 'branch-1',
  branchIds: ['branch-1'],
  isSuperAdmin: false,
  permissions: ['inventory.items.read'],
};

const pictureless: AuthUser = {
  ...reader,
  userId: 'user-nothing',
  username: 'nothing',
  permissions: [],
};

/// The token is not what is under test, so the principal is attached directly.
/// Middleware rather than an interceptor: guards run first, and a principal
/// attached later arrives after the permission check has already failed.
@Injectable()
class PrincipalMiddleware implements NestMiddleware {
  static current: AuthUser = reader;

  use(request: { user?: AuthUser }, _response: unknown, next: () => void) {
    request.user = PrincipalMiddleware.current;
    next();
  }
}

const touched: string[] = [];

const itemImageStub = {
  thumbnails: async (_companyId: string, itemIds: string[]) => {
    touched.push('thumbnails');
    return itemIds.map((itemId) => ({ itemId, data: 'AAAA' }));
  },
  get: async () => {
    touched.push('get');
    return { itemId: 'item-1', data: null, mime: null };
  },
  set: async () => {
    touched.push('set');
    return { itemId: 'item-1' };
  },
  remove: async () => {
    touched.push('remove');
    return { removed: true };
  },
  presence: async () => {
    touched.push('presence');
    return new Set<string>();
  },
};

const itemsStub = {
  findOne: async (_companyId: string, id: string) => {
    touched.push(`findOne:${id}`);
    throw new Error(`Item "${id}" was not found`);
  },
};

@Module({
  controllers: [
    // Deliberately the production order, so this test fails if it ever
    // regresses rather than passing against an idealised module.
    ItemPictureIndexController,
    ItemsController,
    ItemImageController,
  ],
  providers: [
    { provide: ItemImageService, useValue: itemImageStub },
    { provide: ItemsService, useValue: itemsStub },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    PrincipalMiddleware,
  ],
})
class ItemPictureIndexHttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(PrincipalMiddleware)
      .forRoutes(ItemPictureIndexController, ItemsController, ItemImageController);
  }
}

describe('the catalogue picture index over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;

  const get = (path: string) =>
    fetch(`${baseUrl}${path}`, { headers: { 'content-type': 'application/json' } });

  beforeAll(async () => {
    app = await NestFactory.create(ItemPictureIndexHttpModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    touched.length = 0;
    PrincipalMiddleware.current = reader;
  });

  it('answers the literal route instead of reading "with-picture" as an item id', async () => {
    const response = await get(
      '/inventory/items/with-picture?itemIds=11111111-1111-4111-8111-111111111111',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pictures: [{ itemId: '11111111-1111-4111-8111-111111111111', data: 'AAAA' }],
    });
    // The item lookup must not have run at all.
    expect(touched).toEqual(['thumbnails']);
  });

  it('still routes a real id to the item lookup, so the fix hid nothing', async () => {
    const response = await get('/inventory/items/item-1/image');

    expect(response.status).toBe(200);
    expect(touched).toEqual(['get']);
  });

  it('refuses a caller without the read permission', async () => {
    PrincipalMiddleware.current = pictureless;

    const response = await get('/inventory/items/with-picture');

    expect(response.status).toBe(403);
    expect(touched).toEqual([]);
  });

  it('refuses an unauthenticated caller', async () => {
    PrincipalMiddleware.current = {
      ...reader,
      userId: '',
      permissions: [],
    };

    const response = await get('/inventory/items/with-picture');

    expect([401, 403]).toContain(response.status);
    expect(touched).toEqual([]);
  });
});
