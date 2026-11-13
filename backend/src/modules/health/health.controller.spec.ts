import { Request } from 'express';
import { HealthController } from './health.controller';

const os = jest.requireActual<typeof import('node:os')>('node:os');

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

/// The SQL a `$queryRaw` tagged-template call was given. Written out rather
/// than stubbed blindly so a test can prove which statement the controller
/// really sends: the database-name query is the one that has to be cast.
function sqlOfCall(call: unknown[]): string {
  const strings = call[0] as unknown as TemplateStringsArray;
  return Array.isArray(strings) ? strings.join('?') : String(strings);
}

const DATABASE_NAME_ERROR = new Error(
  "Raw query failed. Code: `N/A`. Message: `Failed to deserialize column of type 'name'`",
);

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: any;
  /// Set by a test to make the database-name query fail the way PostgreSQL
  /// and Prisma can, while `SELECT 1` keeps answering.
  let databaseNameError: Error | null;

  beforeEach(() => {
    databaseNameError = null;
    mockPrisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = sqlOfCall([strings]);
        if (/current_database/i.test(sql)) {
          return databaseNameError
            ? Promise.reject(databaseNameError)
            : Promise.resolve([{ name: 'erp_kayan' }]);
        }
        return Promise.resolve([{ '?column?': 1 }]);
      }),
      company: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
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

  it('does not report first-run setup for an existing company with no users', async () => {
    mockPrisma.user = { count: jest.fn().mockResolvedValue(0) };
    const res = await controller.check();
    expect(res.needsSetup).toBe(false);
    expect(res.recoveryRequired).toBe(true);
  });

  it('asks for setup, not recovery, after a reset retired the company', async () => {
    // The settings screen promises the program "will ask to be set up again".
    // The reset keeps the company row so that promise can be kept; /health has
    // to agree with /setup/status or the shell shows recovery instead.
    mockPrisma.company.count.mockImplementation((args?: { where?: unknown }) =>
      Promise.resolve(args?.where ? 0 : 1),
    );
    mockPrisma.company.findFirst.mockResolvedValue({ id: 'retired' });
    mockPrisma.user.count.mockImplementation((args?: { where?: unknown }) =>
      Promise.resolve(args?.where ? 0 : 1),
    );

    const res = await controller.check();

    expect(res.needsSetup).toBe(true);
    expect(res.recoveryRequired).toBe(false);
    // Live companies only, so a retired row cannot make this look set up.
    expect(mockPrisma.company.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    expect(mockPrisma.user.count).toHaveBeenCalledWith();
  });

  it('requires recovery when user rows survive with no company at all', async () => {
    mockPrisma.company.count.mockResolvedValue(0);
    mockPrisma.company.findFirst.mockResolvedValue(null);
    mockPrisma.user.count.mockImplementation((args?: { where?: unknown }) =>
      Promise.resolve(args?.where ? 0 : 1),
    );

    const res = await controller.check();

    expect(res.needsSetup).toBe(false);
    expect(res.recoveryRequired).toBe(true);
  });

  it('reports setup only when the database has no companies or users', async () => {
    mockPrisma.company.count.mockResolvedValue(0);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await controller.check();

    expect(res.needsSetup).toBe(true);
    expect(res.recoveryRequired).toBe(false);
  });

  it('asks for the database name as text, the one shape Prisma can read', async () => {
    // `current_database()` returns PostgreSQL's `name` type, which Prisma
    // cannot deserialise in a raw query. Without the cast, /health reports a
    // working database as down and no installation can ever prove which
    // database it opened.
    await controller.check();
    const statements = mockPrisma.$queryRaw.mock.calls.map(sqlOfCall);
    const nameQuery = statements.find((sql: string) => /current_database/i.test(sql));
    expect(nameQuery).toBeDefined();
    expect(nameQuery).toMatch(/current_database\(\)\s*::text/i);
  });

  it('keeps the database up when only the name query cannot be read', async () => {
    databaseNameError = DATABASE_NAME_ERROR;
    const res = await controller.check();
    expect(res.status).toBe('ok');
    expect(res.database).toBe('up');
    // Not a name from nowhere: the answer says the name is unknown, and the
    // shell decides what an unknown name means.
    expect(res.databaseName).toBeNull();
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
      expect(net.isLanAccessible).toBe(net.addresses.length > 0);
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

  it('does not present a public interface as a LAN address', async () => {
    const previous = process.env.HOST;
    process.env.HOST = '0.0.0.0';
    const interfaces = jest.spyOn(os, 'networkInterfaces').mockReturnValue({
      public: [{ address: '203.0.113.10', family: 'IPv4', internal: false }],
      local: [{ address: '192.168.1.25', family: 'IPv4', internal: false }],
    } as any);
    try {
      const net = await controller.network(fakeRequest());
      expect(net.isLanAccessible).toBe(true);
      expect(net.addresses.map((entry) => entry.address)).toEqual(['192.168.1.25']);
      expect(net.interfaces.map((entry) => entry.address)).toEqual(['192.168.1.25']);
      expect(net.primaryUrl).toMatch(/^http:\/\/192\.168\.1\.25:/);
    } finally {
      interfaces.mockRestore();
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it('does not imply a LAN candidate when only a public interface exists', async () => {
    const previous = process.env.HOST;
    process.env.HOST = '0.0.0.0';
    const interfaces = jest.spyOn(os, 'networkInterfaces').mockReturnValue({
      public: [{ address: '203.0.113.10', family: 'IPv4', internal: false }],
    } as any);
    try {
      const net = await controller.network(fakeRequest());
      expect(net.isLanAccessible).toBe(false);
      expect(net.addresses).toEqual([]);
      expect(net.interfaces).toEqual([]);
      expect(net.primaryUrl).toMatch(/^http:\/\/localhost:/);
    } finally {
      interfaces.mockRestore();
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it('keeps RFC1918 and link-local candidates, but excludes public ranges', async () => {
    const previous = process.env.HOST;
    process.env.HOST = '0.0.0.0';
    const make = (address: string) => ({ address, family: 'IPv4', internal: false });
    const interfaces = jest.spyOn(os, 'networkInterfaces').mockReturnValue({
      mixed: [
        make('10.1.2.3'), make('172.16.0.1'), make('172.31.255.255'),
        make('192.168.0.1'), make('169.254.10.1'), make('172.15.1.1'),
        make('172.32.1.1'), make('198.51.100.1'), make('10.999.1.1'),
      ],
    } as any);
    try {
      const net = await controller.network(fakeRequest());
      expect(net.addresses.map((entry) => entry.address)).toEqual([
        '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.10.1',
      ]);
    } finally {
      interfaces.mockRestore();
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
