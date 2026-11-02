import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Emits RFC 9457 problem-details responses and never leaks stack traces or
 * database errors to the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const isUniqueConstraint =
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002';

    // The fiscal-period trigger is a database backstop: when a path that
    // writes stock movements before its journal reaches it first, its
    // raise (SQLSTATE 23514) would otherwise surface as an opaque 500 for
    // what is really a readable business refusal — the period is closed.
    const exceptionText =
      exception instanceof Error ? exception.message : String(exception ?? '');
    const isClosedPeriodTrigger =
      exceptionText.includes('Fiscal period is closed for company') ||
      exceptionText.includes('kayan_require_open_fiscal_period');

    // The cash-voucher reconciliation trigger (SQLSTATE 23P01) is a database
    // backstop for the same claim race the service serialises with row locks:
    // a voucher already matched to one reconciliation cannot be moved to
    // another. Surface it as a readable conflict instead of an opaque 500.
    const isVoucherClaimTrigger = exceptionText.includes(
      'is already matched to reconciliation',
    );

    const rawStatus =
      typeof exception === 'object' && exception !== null && 'status' in exception
        ? Number((exception as { status?: unknown }).status)
        : typeof exception === 'object' && exception !== null && 'statusCode' in exception
          ? Number((exception as { statusCode?: unknown }).statusCode)
          : 0;
    const requestTooLarge = rawStatus === HttpStatus.PAYLOAD_TOO_LARGE;
    const status = isUniqueConstraint
      ? HttpStatus.CONFLICT
      : isVoucherClaimTrigger
        ? HttpStatus.CONFLICT
        : isClosedPeriodTrigger
        ? HttpStatus.BAD_REQUEST
        : requestTooLarge
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

    let detail = requestTooLarge
      ? 'حجم الملف أو الطلب أكبر من الحد المسموح. قلّل حجم صورة الشعار وحاول مرة أخرى.'
      : 'Unexpected server error';
    let extra: Record<string, unknown> = {};

    if (isUniqueConstraint) {
      detail = 'A record with the same unique value already exists';
    } else if (isVoucherClaimTrigger) {
      detail =
        'One of the selected vouchers is already matched to another bank reconciliation.';
    } else if (isClosedPeriodTrigger) {
      detail =
        'The fiscal period covering this date is closed, so nothing can be posted into it. ' +
        'Use a date in an open period instead.';
    } else if (requestTooLarge) {
      // Keep the bounded-upload explanation above; do not expose parser text.
    } else if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        detail =
          typeof b.detail === 'string'
            ? b.detail
            : Array.isArray(b.message)
              ? (b.message as string[]).join('; ')
              : String(b.message ?? detail);
        if (b.errors) extra = { errors: b.errors };
        // A machine-readable reason travels with the sentence: the client uses
        // it to open the right screen (an expired licence is not a permission
        // problem), and it is safe to show - it names a category, not a secret.
        if (typeof b.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(b.code)) {
          extra = { ...extra, code: b.code };
        }
        if (b.license && typeof b.license === 'object') {
          extra = { ...extra, license: b.license };
        }
      }
    } else {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      type: 'about:blank',
      title: HttpStatus[status] ?? 'Error',
      status,
      detail,
      ...extra,
    });
  }
}
