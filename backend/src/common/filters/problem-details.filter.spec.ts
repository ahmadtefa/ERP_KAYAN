import { Controller, Get, HttpException, HttpStatus, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { ProblemDetailsFilter } from './problem-details.filter';

@Controller('synthetic-problem')
class SyntheticProblemController {
  @Get('internal') internal() {
    throw new HttpException({detail:'synthetic private detail',errors:{value:'synthetic private value'},
      code:'PRIVATE_CODE',license:{token:'synthetic private token'}},500);
  }
  @Get('maintenance') maintenance() {
    throw new HttpException({message:'Maintenance remains active',code:'MAINTENANCE'},503);
  }
}
@Module({controllers:[SyntheticProblemController]}) class SyntheticProblemModule {}

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

  it('does not log an unexpected error message, stack or raw thrown object', () => {
    const response={status:jest.fn().mockReturnThis(),json:jest.fn()};
    const host={switchToHttp:()=>({getResponse:()=>response})} as any;
    const log=jest.spyOn(Logger.prototype,'error').mockImplementation(()=>undefined);
    try {
      const error=new TypeError('synthetic sensitive marker');
      error.stack='synthetic private stack';
      new ProblemDetailsFilter().catch(error,host);
      new ProblemDetailsFilter().catch({message:'synthetic object marker'},host);
      const database=new Prisma.PrismaClientKnownRequestError('synthetic database marker',{
        code:'P2025',clientVersion:'test',meta:{note:'synthetic private metadata'},
      });
      new ProblemDetailsFilter().catch(database,host);
      expect(log.mock.calls).toEqual([
        ['Unhandled server error (TypeError)'],
        ['Unhandled server error (unclassified)'],
        ['Unhandled server error (Prisma P2025)'],
      ]);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/marker|stack|metadata/);
      expect(response.json.mock.calls.every(([body])=>body.detail==='Unexpected server error')).toBe(true);
    } finally {log.mockRestore();}
  });

  it('sanitizes explicit 500 HttpException bodies, even with trigger-like words', () => {
    const response={status:jest.fn().mockReturnThis(),json:jest.fn()};
    const host={switchToHttp:()=>({getResponse:()=>response})} as any;
    const log=jest.spyOn(Logger.prototype,'error').mockImplementation(()=>undefined);
    try {
      const body={detail:'Fiscal period is closed for company synthetic private detail',
        errors:{key:'synthetic private value'},code:'PRIVATE_CODE',license:{token:'synthetic private token'}};
      new ProblemDetailsFilter().catch(new HttpException(body,500),host);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({type:'about:blank',title:'INTERNAL_SERVER_ERROR',status:500,detail:'Unexpected server error'});
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic private');
    } finally {log.mockRestore();}
  });

  it('sanitizes an explicit 500 over real HTTP without changing safe 503 behavior', async () => {
    const app=await NestFactory.create(SyntheticProblemModule,{logger:false});
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0,'127.0.0.1');
    const port=(app.getHttpServer().address() as {port:number}).port;
    try {
      const response=await fetch(`http://127.0.0.1:${port}/synthetic-problem/internal`);
      expect(response.status).toBe(500);
      const text=await response.text();
      expect(text).not.toContain('synthetic private');
      expect(text).not.toContain('PRIVATE_CODE');
      expect(JSON.parse(text).detail).toBe('Unexpected server error');
      const maintenance=await fetch(`http://127.0.0.1:${port}/synthetic-problem/maintenance`);
      expect(maintenance.status).toBe(503);
      expect(await maintenance.json()).toMatchObject({detail:'Maintenance remains active',code:'MAINTENANCE'});
    } finally {await app.close();}
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
