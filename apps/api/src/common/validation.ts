import { BadRequestException, ValidationPipe } from '@nestjs/common';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    exceptionFactory: () => new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
    }),
  });
}
