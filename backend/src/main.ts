import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { isCorsOriginAllowed } from './common/security/cors-origin';

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

  // Development is permissive so Flutter's changing local dev-server port
  // does not break sign-in. Production accepts only explicit CORS_ORIGINS
  // entries; LAN and .local origins are not implicitly trusted.
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (isCorsOriginAllowed(origin, configuredOrigins, isProduction)) {
        return callback(null, true);
      }
      logger.warn(`Blocked CORS request from origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  });

  // If a built copy of the web client sits next to the API, serve it from the
  // same address. One origin means no CORS, no second port to remember, and the
  // browser address is the address of the program itself.
  //
  // Checked in order: explicit env var -> relative to backend -> repo root -> dist bundle.
  const candidateWebRoots = [
    process.env.KAYAN_WEB_ROOT,
    join(process.cwd(), '..', 'build', 'web'),
    join(process.cwd(), 'build', 'web'),
    join(__dirname, '..', '..', 'build', 'web'),
    join(__dirname, '..', 'web'),
  ].filter(Boolean) as string[];

  const webRoot = candidateWebRoots.find((dir) =>
    existsSync(join(dir, 'index.html')),
  );

  if (webRoot) {
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
  logger.log(`Local web access: http://localhost:${port}`);
  if (host === '0.0.0.0') {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          logger.log(`Network LAN access (${name}): http://${net.address}:${port}`);
        }
      }
    }
  }
  // A line the desktop shell can wait for, in addition to the health route.
  logger.log(`KAYAN-API-READY port=${port} host=${host}`);
}
void bootstrap();
