import { Request } from 'express';
import { HealthController } from './health.controller';

/// The parts of the request the network report reads: where it arrived, and
/// whether the transport was encrypted.
function fakeRequest(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    headers: {},
    secure: false,
    socket: { localAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ name: 'erp_kayan' }]),
      company: {
        count: jest.fn().mockResolvedValue(1),
      },
    };
    controller = new HealthController(mockPrisma);
  });

  it('reports healthy status when DB is up', async () => {
    const res = await controller.check();
    expect(res.status).toBe('ok');
    expect(res.database).toBe('up');
    expect(res.needsSetup).toBe(false);
    // The desktop shell proves it reached the right database with this.
    expect(res.databaseName).toBe('erp_kayan');
  });

  it('reports no database name when the database cannot be asked', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const res = await controller.check();
    expect(res.status).toBe('degraded');
    expect(res.database).toBe('down');
    expect(res.databaseName).toBeNull();
  });

  it('reports network interface info', async () => {
    const previous = process.env.HOST;
    process.env.HOST = '0.0.0.0';
    try {
      const net = await controller.network(fakeRequest({ headers: { host: '127.0.0.1:3000' } }));
      expect(net.port).toBeDefined();
      expect(net.host).toBe('0.0.0.0');
      expect(net.isLanAccessible).toBe(true);
      expect(net.bindAllInterfaces).toBe(true);
      expect(Array.isArray(net.addresses)).toBe(true);
      expect(typeof net.primaryUrl).toBe('string');
      expect(net.database).toBe('up');
      expect(net.localUrl).toMatch(/^http:\/\/localhost:\d+$/);
      // A plain http page is not a secure context, so the browser keeps the
      // session in memory. Reported from this request, not guessed.
      expect(net.secureContext).toBe(false);
      expect(net.sessionStorage).toBe('durable'); // loopback is a secure context
      // Every offered address is a link that can actually be opened from
      // another machine: no loopback, no hostname-less placeholder.
      for (const address of net.addresses) {
        expect(address.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
        expect(address.address.startsWith('127.')).toBe(false);
      }
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it('hands out only the local address when the server is bound to loopback', async () => {
    const previous = process.env.HOST;
    process.env.HOST = '127.0.0.1';
    try {
      const net = await controller.network(fakeRequest());
      expect(net.isLanAccessible).toBe(false);
      expect(net.addresses).toEqual([]);
      expect(net.primaryUrl).toMatch(/^http:\/\/localhost:\d+$/);
      // The interfaces are still listed so the screen can explain which
      // address would be used if the binding were opened up.
      expect(Array.isArray(net.interfaces)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });
});
