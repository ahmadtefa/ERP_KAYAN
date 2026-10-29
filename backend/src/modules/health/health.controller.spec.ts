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

  it("serializes the database name as JSON to avoid PostgreSQL's internal name type", async () => {
    // `current_database()` returns PostgreSQL's `name` type, which Prisma
    // cannot deserialise in a raw query. Without the cast, /health reports a
    // working database as down and no installation can ever prove which
    // database it opened.
    await controller.check();
    const statements = mockPrisma.$queryRaw.mock.calls.map(sqlOfCall);
    const nameQuery = statements.find((sql: string) => /current_database/i.test(sql));
    expect(nameQuery).toBeDefined();
    expect(nameQuery).toMatch(/to_json\(current_database\(\)\)/i);
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
