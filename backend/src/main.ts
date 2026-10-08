import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
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

  // If a built copy of the web client sits next to the API, serve it from the
  // same address. One origin means no CORS, no second port to remember, and the
  // browser address is the address of the program itself.
  //
  //   cd backend && npm run build        (or: flutter build web first)
  //
  // The folder is optional: without it the API behaves exactly as before and
  // the client is served by its own dev server.
  const webRoot = join(process.cwd(), '..', 'build', 'web');
  if (existsSync(join(webRoot, 'index.html'))) {
    app.useStaticAssets(webRoot);
    // Any other path that is not part of the API belongs to the client's own
    // routing, so hand back the page and let the client route it.
    const server = app.getHttpAdapter().getInstance();
    server.get(
      /^\/(?!api\/).*/,
      (
        _request: unknown,
        response: { sendFile: (path: string) => void },
      ) => response.sendFile(join(webRoot, 'index.html')),
    );
    logger.log(`Serving the web client from ${webRoot}`);
  } else {
    logger.log(
      'No web build found; the client is served by its own dev server',
    );
  }

  // Where the API listens.
  //
  // The default is every interface, so a server installation is reachable from
  // the other devices on the same network (phones, tablets, a second desk).
  // A desktop installation sets HOST=127.0.0.1: there the API is a private
  // part of one program on one machine, and nothing else should be able to
  // reach it.
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  logger.log(`API listening on http://${host}:${port}/api/v1`);
  // A line the desktop shell can wait for, in addition to the health route.
  logger.log(`KAYAN-API-READY port=${port} host=${host}`);
}
void bootstrap();
