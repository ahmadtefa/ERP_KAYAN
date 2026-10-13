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
});
