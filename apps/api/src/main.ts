import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The Expo client runs on a different origin during development.
  app.enableCors({ origin: true });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
}
void bootstrap();
