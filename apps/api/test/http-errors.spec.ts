import 'reflect-metadata';
import { BadRequestException, Controller, Get, InternalServerErrorException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpErrorFilter } from '../dist/common/http-errors.js';

@Controller()
class FailureController {
  @Get('failure')
  failure(): never { throw new Error('private-placeholder-credentials'); }

  @Get('upstream-failure')
  upstreamFailure(): never { throw new InternalServerErrorException('private-placeholder-credentials'); }

  @Get('invalid')
  invalid(): never { throw new BadRequestException('private-placeholder-input'); }
}

describe('HTTP error policy', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FailureController] }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('normalizes missing routes without echoing the requested path', async () => {
    const response = await request(app.getHttpServer()).get('/private-placeholder-route');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Resource not found.' });
  });

  it.each(['/failure', '/upstream-failure'])('hides unexpected failure details at %s', async (path) => {
    const response = await request(app.getHttpServer()).get(path);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  });

  it('normalizes bad requests without echoing arbitrary exception input', async () => {
    const response = await request(app.getHttpServer()).get('/invalid');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'BAD_REQUEST', message: 'Invalid request.' });
  });
});
