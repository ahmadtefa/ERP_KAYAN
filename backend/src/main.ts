import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api/v1');

  // Reject unknown properties so a typo cannot silently create a half-formed
  // financial document.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new ProblemDetailsFilter());

  // A browser only lets a page call this API when the reply carries an
  // Access-Control-Allow-Origin header naming that page's origin. The Flutter
  // web dev server chooses the port it serves the client on, so a hard list of
  // ports breaks sign-in with a misleading "cannot reach the server" error.
  // Outside production every localhost origin is therefore accepted; in
  // production only the origins listed in CORS_ORIGINS are.
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Requests without an Origin header come from clients that CORS does not
      // apply to: native apps, curl, the mobile build.
      if (!origin) return callback(null, true);
      if (configuredOrigins.includes(origin)) return callback(null, true);
      if (!isProduction && isLocalOrigin.test(origin)) return callback(null, true);
      logger.warn(`Blocked CORS request from origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  });

  // Listen on all interfaces so the API is reachable from other devices on
  // the local network (phones/tablets), not only from localhost.
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on http://localhost:${port}/api/v1`);
}
void bootstrap();
