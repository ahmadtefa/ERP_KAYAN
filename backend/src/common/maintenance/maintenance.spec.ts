import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { of, Subject } from 'rxjs';
import { MaintenanceInterceptor, MaintenanceService } from './maintenance';

describe('MaintenanceInterceptor', () => {
  function context(method: string, path: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, path }),
      }),
    } as unknown as ExecutionContext;
  }

  it('blocks new backup writes other than a controlled restore recovery', () => {
    const maintenance = new MaintenanceService();
    maintenance.begin('Restoring database');
    const interceptor = new MaintenanceInterceptor(maintenance);
    const next = { handle: jest.fn(() => of('ok')) };

    expect(() =>
      interceptor.intercept(context('POST', '/api/v1/backup/full'), next as any),
    ).toThrow(ServiceUnavailableException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('allows the full-restore endpoint to attempt recovery during maintenance', () => {
    const maintenance = new MaintenanceService();
    maintenance.begin('ATTENTION: automatic recovery failed');
    const interceptor = new MaintenanceInterceptor(maintenance);
    const stream = of('restore');
    const next = { handle: jest.fn(() => stream) };

    expect(
      interceptor.intercept(context('POST', '/api/v1/backup/full/restore'), next as any),
    ).toBe(stream);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it.each(['/api/v1/invoices', '/reports', '/api/v1/backup/full/unsafe', '/healthcare'])('blocks business GET %s during maintenance', (path) => {
    const maintenance = new MaintenanceService();
    maintenance.begin('Restoring database');
    const interceptor = new MaintenanceInterceptor(maintenance);
    const next = { handle: jest.fn(() => of('ok')) };
    expect(() => interceptor.intercept(context('GET', path), next as any)).toThrow(ServiceUnavailableException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/health', '/backup/full', '/api/v1/backup/full/synthetic.dump/download'])('allows safe diagnostic or backup file GET %s', (path) => {
    const maintenance = new MaintenanceService();
    maintenance.begin('Restoring database');
    const interceptor = new MaintenanceInterceptor(maintenance);
    const next = { handle: jest.fn(() => of('ok')) };
    interceptor.intercept(context('GET', path), next as any);
    expect(next.handle).toHaveBeenCalledTimes(1);
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
  it('drains admitted business handlers and refuses new work during the wait', async () => {
    const maintenance = new MaintenanceService();
    const interceptor = new MaintenanceInterceptor(maintenance);
    const stream = new Subject<string>();
    const next = { handle: () => stream };
    interceptor.intercept(context('POST', '/invoices'), next).subscribe();
    maintenance.begin('Restoring database');
    const finished = jest.fn();
    const drain = maintenance.waitForBusinessRequests().then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(() => interceptor.intercept(context('GET', '/invoices'), next)).toThrow(ServiceUnavailableException);
    stream.complete();
    await drain;
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('fails on the deadline and can drain on a subsequent attempt', async () => {
    const maintenance = new MaintenanceService();
    const release = maintenance.trackBusinessRequest();
    await expect(maintenance.waitForBusinessRequests(1)).rejects.toThrow(/database was not changed/);
    const retry = maintenance.waitForBusinessRequests();
    release();
    await expect(retry).resolves.toBeUndefined();
  });
});
