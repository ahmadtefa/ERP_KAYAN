import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { of } from 'rxjs';
import { MaintenanceInterceptor, MaintenanceService } from './maintenance';

describe('MaintenanceInterceptor', () => {
  function context(method: string, path: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, path }),
      }),
    } as unknown as ExecutionContext;
  }

  it('blocks new write operations on backup routes while maintenance is active', () => {
    const maintenance = new MaintenanceService();
    maintenance.begin('Restoring database');
    const interceptor = new MaintenanceInterceptor(maintenance);
    const next = { handle: jest.fn(() => of('ok')) };

    expect(() =>
      interceptor.intercept(context('POST', '/api/v1/backup/full/restore'), next as any),
    ).toThrow(ServiceUnavailableException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('keeps GET status requests available while maintenance is active', () => {
    const maintenance = new MaintenanceService();
    maintenance.begin('Restoring database');
    const interceptor = new MaintenanceInterceptor(maintenance);
    const stream = of('status');
    const next = { handle: jest.fn(() => stream) };

    expect(
      interceptor.intercept(context('GET', '/api/v1/backup/full/status'), next as any),
    ).toBe(stream);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});
