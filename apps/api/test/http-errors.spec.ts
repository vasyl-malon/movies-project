import 'reflect-metadata';
import { BadRequestException, Controller, Get, InternalServerErrorException, HttpException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpErrorFilter } from '../dist/common/http-errors.js';
import { OmdbError } from '../dist/modules/media/omdb.client.js';

@Controller()
class FailureController {
  @Get('failure')
  failure(): never { throw new Error('private-placeholder-credentials'); }

  @Get('upstream-failure')
  upstreamFailure(): never { throw new InternalServerErrorException('private-placeholder-credentials'); }

  @Get('forged-provider-error')
  forgedProviderError(): never { throw new HttpException({ code: 'OMDB_TIMEOUT', message: 'secret-key-url' }, 504); }

  @Get('safe-provider-error')
  safeProviderError(): never {
    const error = new OmdbError('OMDB_TIMEOUT');
    Object.assign(error.getResponse(), { message: 'secret-key-url' });
    throw error;
  }

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

  it('permits only its safe provider error class and predefined messages', async () => {
    const forged = await request(app.getHttpServer()).get('/forged-provider-error');
    expect(forged.status).toBe(504);
    expect(forged.body).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    const safe = await request(app.getHttpServer()).get('/safe-provider-error');
    expect(safe.status).toBe(504);
    expect(safe.body).toEqual({ code: 'OMDB_TIMEOUT', message: 'Media provider timed out.' });
  });

  it('normalizes bad requests without echoing arbitrary exception input', async () => {
    const response = await request(app.getHttpServer()).get('/invalid');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'BAD_REQUEST', message: 'Invalid request.' });
  });
});
