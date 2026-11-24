import { ValidationPipe } from '@nestjs/common';
import { IsInt, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { ProblemDetailsFilter } from '../filters/problem-details.filter';
import { validationExceptionFactory } from './field-errors';

class Line {
  @IsInt() @Min(1) quantity!: number;
}
class Body {
  @IsString() @MinLength(3) name!: string;
  @ValidateNested({ each: true }) @Type(() => Line) lines!: Line[];
}

describe('validation field errors', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });

  it('names each invalid field, including nested ones, and keeps the summary', async () => {
    let caught: any;
    try {
      await pipe.transform({ name: 'a', lines: [{ quantity: 0 }], extra: 1 }, { type: 'body', metatype: Body });
    } catch (e) {
      caught = e;
    }
    const body = caught.getResponse();
    expect(Object.keys(body.errors).sort()).toEqual(['extra', 'lines.0.quantity', 'name']);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message.length).toBe(3);
    expect(body.errors.name).toBe('الطول يجب ألا يقل عن 3 حرفًا');
    expect(body.errors['lines.0.quantity']).toBe('القيمة يجب ألا تقل عن 1');
    expect(body.errors.extra).toBe('هذا الحقل غير مسموح به');
  });

  it('is passed through by the problem-details filter as fieldErrors', () => {
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json, setHeader: jest.fn(), type: jest.fn().mockReturnThis() };
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ headers: {}, url: '/x', method: 'POST' }) }) };
    new ProblemDetailsFilter().catch(validationExceptionFactory([{ property: 'name', constraints: { minLength: 'name must be longer than or equal to 5 characters' } } as any]), host as any);
    const sent = json.mock.calls[0][0];
    expect(sent.fieldErrors).toEqual({ name: 'الطول يجب ألا يقل عن 5 حرفًا' });
    expect(sent.status ?? 400).toBe(400);
  });
});
