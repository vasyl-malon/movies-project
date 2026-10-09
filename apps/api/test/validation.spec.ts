import 'reflect-metadata';
import { IsInt, Max, Min } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../dist/common/validation.js';

class InputDto {
  @IsInt()
  @Min(1)
  @Max(10)
  rating!: number;
}

const metadata = { type: 'body' as const, metatype: InputDto };

describe('request validation policy', () => {
  it('transforms valid request bodies into the declared DTO', async () => {
    const result = await createValidationPipe().transform({ rating: 7 }, metadata);
    expect(result).toBeInstanceOf(InputDto);
    expect(result.rating).toBe(7);
  });

  it.each([{ rating: 11 }, { rating: '7' }, { rating: 7, secret: 'private-placeholder' }])('rejects invalid or undeclared input with a safe error envelope', async (input) => {
    await expect(createValidationPipe().transform(input, metadata)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR', message: 'Request validation failed.' },
    });
  });
});
