import 'reflect-metadata';
import { NotFoundException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompaniesController } from './companies.controller';

const OWN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function response() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    end: jest.fn(),
  };
}

describe('company logo by id', () => {
  const companies = { getLogo: jest.fn() };
  const controller = new CompaniesController(companies as never, {} as never);
  const user = { userId: 'u', companyId: OWN } as never;

  beforeEach(() => {
    companies.getLogo.mockReset();
    companies.getLogo.mockResolvedValue({ data: Buffer.from([1, 2, 3]), mime: 'image/png' });
  });

  it('is not a public route, while the sole-company route and branding stay public', () => {
    const meta = (name: keyof CompaniesController) =>
      Reflect.getMetadata(IS_PUBLIC_KEY, CompaniesController.prototype[name] as object);
    expect(meta('tenantLogo')).toBeFalsy();
    expect(meta('publicLogo')).toBe(true);
    expect(meta('branding')).toBe(true);
  });

  it('turns away a request with no session before the handler runs', async () => {
    const guard = new JwtAuthGuard(new Reflector(), {} as never, {} as never);
    const request = { headers: {}, query: {} };
    const context = {
      getHandler: () => CompaniesController.prototype.tenantLogo,
      getClass: () => CompaniesController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("serves a member their own company's logo, privately cached", async () => {
    const res = response();
    await controller.tenantLogo(user, OWN, res as never);
    expect(companies.getLogo).toHaveBeenCalledWith(OWN);
    expect(res.headers['Cache-Control']).toBe('private, max-age=300');
    expect(res.end).toHaveBeenCalled();
  });

  it("answers another company's id like an unknown one and never reads its logo", async () => {
    const res = response();
    await expect(controller.tenantLogo(user, OTHER, res as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(companies.getLogo).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });
});
