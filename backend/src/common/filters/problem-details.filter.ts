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

    const rawStatus =
      typeof exception === 'object' && exception !== null && 'status' in exception
        ? Number((exception as { status?: unknown }).status)
        : typeof exception === 'object' && exception !== null && 'statusCode' in exception
          ? Number((exception as { statusCode?: unknown }).statusCode)
          : 0;
    const requestTooLarge = rawStatus === HttpStatus.PAYLOAD_TOO_LARGE;
    const status = isUniqueConstraint
      ? HttpStatus.CONFLICT
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
