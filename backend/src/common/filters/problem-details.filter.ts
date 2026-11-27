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
import { ClosedDatabaseTransactionError } from '../prisma/transaction-lifetime';

/**
 * Emits RFC 9457 problem-details responses and never leaks stack traces or
 * database errors to the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const isClosedTransaction = exception instanceof ClosedDatabaseTransactionError;
    // A transaction that waited too long for a lock or a connection (Prisma
    // P2028 / P2024) was rolled back in full: nothing was saved. It is a busy
    // server, not a bug, and the person is told to try again.
    const isBusy =
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      (exception.code === 'P2028' || exception.code === 'P2024');
    const isUniqueConstraint =
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002';

    // The fiscal-period trigger is a database backstop: when a path that
    // writes stock movements before its journal reaches it first, its
    // raise (SQLSTATE 23514) would otherwise surface as an opaque 500 for
    // what is really a readable business refusal — the period is closed.
    const exceptionText =
      exception instanceof Error ? exception.message : String(exception ?? '');
    const isPrismaDatabaseError =
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError;
    const isClosedPeriodTrigger = isPrismaDatabaseError && (
      exceptionText.includes('Fiscal period is closed for company') ||
      exceptionText.includes('kayan_require_open_fiscal_period'));

    // The cash-voucher reconciliation trigger (SQLSTATE 23P01) is a database
    // backstop for the same claim race the service serialises with row locks:
    // a voucher already matched to one reconciliation cannot be moved to
    // another. Surface it as a readable conflict instead of an opaque 500.
    const isVoucherClaimTrigger = isPrismaDatabaseError && exceptionText.includes(
      'is already matched to reconciliation',
    );

    const rawStatus =
      typeof exception === 'object' && exception !== null && 'status' in exception
        ? Number((exception as { status?: unknown }).status)
        : typeof exception === 'object' && exception !== null && 'statusCode' in exception
          ? Number((exception as { statusCode?: unknown }).statusCode)
          : 0;
    const requestTooLarge = rawStatus === HttpStatus.PAYLOAD_TOO_LARGE;
    const status = isClosedTransaction || isBusy ? HttpStatus.SERVICE_UNAVAILABLE : isUniqueConstraint
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

    if (isClosedTransaction) {
      detail = 'The operation took too long and was rolled back. Reload the document to check its state before trying again.';
      extra = { code: 'TRANSACTION_ROLLED_BACK' };
    } else if (isBusy) {
      detail = 'The server is busy and this operation was cancelled. Nothing was saved. Try again in a moment.';
      extra = { code: 'SERVER_BUSY' };
      response.setHeader('Retry-After', '2');
      this.logger.warn(`Operation cancelled while waiting for the database (Prisma ${(exception as Prisma.PrismaClientKnownRequestError).code})`);
    } else if (isUniqueConstraint) {
      detail = 'A record with the same unique value already exists';
      // Name the constraint (never the values) so an operator can tell which
      // rule fired; the client still gets only the generic sentence above.
      const meta = (exception as Prisma.PrismaClientKnownRequestError).meta as
        { modelName?: unknown; target?: unknown } | undefined;
      this.logger.warn(
        `Unique constraint refused a write: model=${String(meta?.modelName ?? '?')} target=${JSON.stringify(meta?.target ?? '?')}`,
      );
    } else if (isVoucherClaimTrigger) {
      detail =
        'One of the selected vouchers is already matched to another bank reconciliation.';
    } else if (isClosedPeriodTrigger) {
      detail =
        'The fiscal period covering this date is closed, so nothing can be posted into it. ' +
        'Use a date in an open period instead.';
    } else if (requestTooLarge) {
      // Keep the bounded-upload explanation above; do not expose parser text.
    } else if (status === HttpStatus.INTERNAL_SERVER_ERROR && exception instanceof HttpException) {
      // An explicit HttpException(500) can contain just as much sensitive
      // detail as any other unexpected exception. Never forward its body.
      this.logger.error('Unhandled server error (HTTP 500)');
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
        if (b.errors) extra = { errors: b.errors, fieldErrors: b.errors };
        if (typeof b.userAction === 'string' && b.userAction.length <= 300) {
          extra = { ...extra, userAction: b.userAction };
        }
        // A machine-readable reason travels with the sentence: the client uses
        // it to open the right screen (an expired licence is not a permission
        // problem), and it is safe to show - it names a category, not a secret.
        if (typeof b.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(b.code)) {
          extra = { ...extra, code: b.code };
        }
        // The name of the input a refusal is about, so the app can point at it.
        // Only a plain identifier travels: no text a person typed.
        if (typeof b.field === 'string' && /^[A-Za-z][A-Za-z0-9.]{0,39}$/.test(b.field)) {
          extra = { ...extra, errorField: b.field };
        }
        // Credit figures for a permitted viewer: forwarded only for the credit
        // refusal code, only these four keys, only plain decimal strings.
        if (b.code === 'CUSTOMER_CREDIT_LIMIT_EXCEEDED' && b.creditSummary && typeof b.creditSummary === 'object') {
          const src = b.creditSummary as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const k of ['creditLimit', 'currentBalance', 'invoiceAmount', 'projectedBalance']) {
            const v = src[k];
            if (typeof v === 'string' && /^-?\d{1,15}(\.\d{1,4})?$/.test(v)) out[k] = v;
          }
          if (Object.keys(out).length === 4) extra = { ...extra, creditSummary: out };
        }
        if (b.license && typeof b.license === 'object') {
          extra = { ...extra, license: b.license };
        }
      }
    } else {
      // Database/HTTP stacks and arbitrary thrown values may contain query
      // arguments, connection strings or file contents. Keep only a bounded
      // diagnostic category/code; never pass the object or stack to Logger.
      const databaseCode = exception instanceof Prisma.PrismaClientKnownRequestError &&
        /^P[0-9]{4}$/.test(exception.code) ? exception.code : null;
      const category = databaseCode ? `Prisma ${databaseCode}`
        : exception instanceof TypeError ? 'TypeError'
        : exception instanceof RangeError ? 'RangeError'
        : exception instanceof SyntaxError ? 'SyntaxError'
        : 'unclassified';
      this.logger.error(`Unhandled server error (${category})`);
    }

    response.status(status).json({
      type: 'about:blank',
      title: HttpStatus[status] ?? 'Error',
      status,
      detail,
      message: detail,
      ...(typeof extra.code === 'string' ? { errorCode: extra.code } : {}),
      ...extra,
    });
  }
}
