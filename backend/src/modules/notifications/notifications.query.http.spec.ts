import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ExpiryAlertScheduler } from './expiry-alert.scheduler';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const service = {
  list: jest.fn(async (_user: unknown, query: { page?: number; pageSize?: number }) => ({
    items: [], total: 0, page: query.page, pageSize: query.pageSize,
  })),
};

@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: NotificationsService, useValue: service },
    { provide: ExpiryAlertScheduler, useValue: {} },
  ],
})
class NotificationQueryFixture {}

describe('notifications query pagination over HTTP', () => {
  it('transforms Flutter-like string page and pageSize parameters before validation', async () => {
    const app = await NestFactory.create(NotificationQueryFixture, { logger: false });
    app.use((req: { user?: object }, _res: unknown, next: () => void) => {
      req.user = {
        userId: 'user-1', companyId: 'company-1', branchId: null,
        isSuperAdmin: false, permissions: ['notifications.read'],
      };
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
    }));
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    const request = (query: string) => fetch(`http://127.0.0.1:${port}/notifications?${query}`);
    try {
      for (const size of ['5', '100', '200']) {
        const response = await request(`page=1&pageSize=${size}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ page: 1, pageSize: Number(size) });
      }
      expect(service.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        { page: 1, pageSize: 200 },
      );
      const tooLarge = await request('page=1&pageSize=201');
      expect(tooLarge.status).toBe(400);
      const invalid = await request('page=abc&pageSize=abc');
      expect(invalid.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});
