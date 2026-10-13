import { HttpException, HttpStatus } from '@nestjs/common';
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
});
