import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { ApiError } from '@tracker/contracts';
import type { Response } from 'express';
import { OmdbError, OMDB_FAILURES } from '../modules/media/omdb.client.js';

const errors: Record<number, ApiError> = {
  400: { code: 'BAD_REQUEST', message: 'Invalid request.' },
  401: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
  403: { code: 'FORBIDDEN', message: 'Access denied.' },
  404: { code: 'NOT_FOUND', message: 'Resource not found.' },
  409: { code: 'CONFLICT', message: 'Request conflicts with current state.' },
  422: { code: 'UNPROCESSABLE_ENTITY', message: 'Request could not be processed.' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests.' },
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    let error: ApiError = status >= 500
      ? { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }
      : errors[status] ?? { code: 'REQUEST_ERROR', message: 'Request failed.' };

    if (status === 400 && exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && 'code' in body && body.code === 'VALIDATION_ERROR') {
        error = { code: 'VALIDATION_ERROR', message: 'Request validation failed.' };
      }
    }

    if (exception instanceof OmdbError) {
      error = { code: exception.code, message: OMDB_FAILURES[exception.code].message };
    }

    host.switchToHttp().getResponse<Response>().status(status).json(error);
  }
}
