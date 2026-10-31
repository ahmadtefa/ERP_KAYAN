import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProblemDetailsFilter } from './problem-details.filter';

describe('ProblemDetailsFilter', () => {
  it('preserves an explicit problem-details description', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as any;
    const filter = new ProblemDetailsFilter();

    filter.catch(
      new HttpException(
        {
          type: 'about:blank',
          title: 'TOO_MANY_REQUESTS',
          status: HttpStatus.TOO_MANY_REQUESTS,
          detail: 'Too many attempts. Try again shortly.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: 'Too many attempts. Try again shortly.',
      }),
    );
  });

  it('maps Prisma unique violations to HTTP 409 without leaking database details', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as any;
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['Company_one_active_company_idx'] },
    });

    new ProblemDetailsFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'CONFLICT',
      status: HttpStatus.CONFLICT,
      detail: 'A record with the same unique value already exists',
    });
    expect(response.json.mock.calls[0][0].detail).not.toContain(
      'Company_one_active_company_idx',
    );
  });

  it('turns the closed-period database backstop into a readable 400', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as any;
    // The shape Prisma gives a trigger raise: an unknown request error whose
    // message carries the function's own words (and the company id, which
    // must not be echoed back).
    const error = new Prisma.PrismaClientUnknownRequestError(
      'Raw query failed. Code: `23514`. Message: `Fiscal period is closed ' +
        'for company 8b0e2c1c-0000-4000-8000-000000000000 on 2024-06-01`',
      { clientVersion: 'test' },
    );

    new ProblemDetailsFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = response.json.mock.calls[0][0];
    expect(body.status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.detail).toContain('fiscal period');
    expect(body.detail).not.toContain('8b0e2c1c');
    expect(body.detail).not.toContain('23514');
  });

  it('turns the voucher-claim database backstop into a readable 409', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as any;
    const error = new Prisma.PrismaClientUnknownRequestError(
      'Raw query failed. Code: `23P01`. Message: `cash voucher PV-0042 is already ' +
        'matched to reconciliation 8b0e2c1c-0000-4000-8000-000000000000`',
      { clientVersion: 'test' },
    );

    new ProblemDetailsFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = response.json.mock.calls[0][0];
    expect(body.status).toBe(HttpStatus.CONFLICT);
    expect(body.detail).toContain('already matched');
    expect(body.detail).not.toContain('8b0e2c1c');
    expect(body.detail).not.toContain('23P01');
  });
});
