import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
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
  });

  it('reports network interface info', () => {
    const previous = process.env.HOST;
    process.env.HOST = '0.0.0.0';
    try {
      const net = controller.network();
      expect(net.port).toBeDefined();
      expect(net.host).toBe('0.0.0.0');
      expect(net.isLanAccessible).toBe(true);
      expect(Array.isArray(net.addresses)).toBe(true);
      expect(typeof net.primaryUrl).toBe('string');
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it('hands out only the local address when the server is bound to loopback', () => {
    const previous = process.env.HOST;
    process.env.HOST = '127.0.0.1';
    try {
      const net = controller.network();
      expect(net.isLanAccessible).toBe(false);
      expect(net.addresses).toEqual([]);
      expect(net.primaryUrl).toMatch(/^http:\/\/localhost:\d+$/);
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });
});
