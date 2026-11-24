import { BadRequestException, ValidationError } from '@nestjs/common';

/// Walks class-validator's error tree and returns one message per field,
/// keyed by the dotted path the client sent (`items.0.quantity`).
export function collectFieldErrors(
  errors: ValidationError[],
  prefix = '',
  into: Record<string, string> = {},
): Record<string, string> {
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) {
      const first = Object.values(error.constraints)[0];
      if (first && !(path in into)) into[path] = first;
    }
    if (error.children?.length) collectFieldErrors(error.children, path, into);
  }
  return into;
}

/// Turns a failed DTO validation into a 400 that names every bad field, so a
/// form can mark each one instead of showing one long sentence. `message`
/// keeps the readable summary older clients already show.
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const fieldErrors = collectFieldErrors(errors);
  const message = Object.entries(fieldErrors).map(([field, text]) => text);
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message,
    errors: fieldErrors,
    code: 'VALIDATION_FAILED',
  });
}
