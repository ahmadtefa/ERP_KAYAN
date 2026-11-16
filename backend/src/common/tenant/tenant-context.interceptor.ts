import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { AuthUser } from '../decorators/current-user.decorator';
import { runWithTenantContext } from './tenant-context';

/**
 * Binds the verified principal's company to the request's async chain.
 *
 * Runs after JwtAuthGuard (guards run before interceptors), so `request.user`
 * is the database-verified principal - never a client-supplied header. Every
 * database transaction started while handling the request inherits this
 * context through AsyncLocalStorage and binds it transaction-locally inside
 * PostgreSQL (see tenant-prisma-pg.ts), so nothing can leak across requests or
 * pooled connections.
 *
 * Public routes (login, setup) carry no principal and therefore run with no
 * tenant context - deny by default - until they opt into a reviewed mode via
 * runWithTenantContext in their service.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;

    if (!user?.companyId) {
      return next.handle();
    }

    // The handler is invoked on subscribe, so subscribing inside the ALS run
    // binds the context to the controller's async chain (including every
    // awaited database call it makes).
    return new Observable((subscriber) => {
      let inner: Subscription | undefined;
      void runWithTenantContext({ companyId: user.companyId }, () => {
        inner = next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
        return Promise.resolve();
      });
      return () => inner?.unsubscribe();
    });
  }
}
