import { BadRequestException, ValidationError } from '@nestjs/common';

/// The reason a value was refused, in Arabic, for the constraint that failed
/// first. It sits beside the field, so it does not repeat the field's name.
/// A constraint with no sentence here keeps class-validator's own text.
export function arabicReason(kind: string, original: string): string {
  const limit = original.match(/(-?\d+(?:\.\d+)?)(?!.*\d)/)?.[1];
  const table: Record<string, string> = {
    isNotEmpty: 'هذا الحقل مطلوب',
    isDefined: 'هذا الحقل مطلوب',
    isString: 'القيمة يجب أن تكون نصًا',
    isInt: 'القيمة يجب أن تكون رقمًا صحيحًا',
    isNumber: 'القيمة يجب أن تكون رقمًا',
    isNumberString: 'القيمة يجب أن تكون رقمًا',
    isDecimal: 'القيمة يجب أن تكون رقمًا عشريًا صحيحًا',
    isPositive: 'القيمة يجب أن تكون أكبر من صفر',
    isBoolean: 'القيمة يجب أن تكون نعم أو لا',
    isEmail: 'البريد الإلكتروني غير صحيح',
    isUUID: 'القيمة المختارة غير صالحة، اختر من القائمة',
    isIn: 'القيمة المختارة غير مسموح بها',
    isEnum: 'القيمة المختارة غير مسموح بها',
    isDateString: 'التاريخ غير صحيح',
    isISO8601: 'التاريخ غير صحيح',
    isArray: 'يجب إضافة قائمة قيم',
    matches: 'الصيغة المكتوبة غير صحيحة',
    whitelistValidation: 'هذا الحقل غير مسموح به',
    min: limit ? `القيمة يجب ألا تقل عن ${limit}` : 'القيمة أقل من الحد الأدنى',
    max: limit ? `القيمة يجب ألا تزيد على ${limit}` : 'القيمة أكبر من الحد الأقصى',
    minLength: limit ? `الطول يجب ألا يقل عن ${limit} حرفًا` : 'النص أقصر من المسموح',
    maxLength: limit ? `الطول يجب ألا يزيد على ${limit} حرفًا` : 'النص أطول من المسموح',
    arrayMinSize: limit ? `يجب إضافة ${limit} عنصر على الأقل` : 'يجب إضافة عنصر واحد على الأقل',
    arrayMaxSize: limit ? `لا يزيد عدد العناصر على ${limit}` : 'عدد العناصر أكبر من المسموح',
  };
  return table[kind] ?? original;
}

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
      const [kind, text] = Object.entries(error.constraints)[0] ?? [];
      if (kind && !(path in into)) into[path] = arabicReason(kind, text);
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
  const message = Object.entries(fieldErrors).map(([field, text]) => `${field}: ${text}`);
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message,
    errors: fieldErrors,
    code: 'VALIDATION_FAILED',
  });
}
