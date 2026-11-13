import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { SessionIdGuard } from './session-id.guard.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Only the listed origins (the Expo dev server by default) may call the API
  // from a browser; `origin: true` would let any website drive a local API.
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:8081')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins });
  app.useGlobalGuards(new SessionIdGuard());
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
}
void bootstrap();
