import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { logger } from './common/logger.js';

async function bootstrap(): Promise<void> {
  const cfg = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: cfg.NODE_ENV === 'production' ? undefined : false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  await app.listen(cfg.API_PORT);
  logger.info({ port: cfg.API_PORT, env: cfg.NODE_ENV }, 'API iniciada');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'falha ao iniciar API');
  process.exit(1);
});
