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
    const net = controller.network();
    expect(net.port).toBeDefined();
    expect(net.host).toBeDefined();
    expect(Array.isArray(net.addresses)).toBe(true);
    expect(typeof net.primaryUrl).toBe('string');
  });
});
