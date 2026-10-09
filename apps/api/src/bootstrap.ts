import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './common/http-errors.js';
import { createValidationPipe } from './common/validation.js';
import type { ApiConfig } from './config.js';

export function configureApplication(app: INestApplication, config: ApiConfig): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableCors({ origin: config.frontendOrigin, credentials: true });
}

export async function createApplication(config: ApiConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configureApplication(app, config);
  return app;
}
