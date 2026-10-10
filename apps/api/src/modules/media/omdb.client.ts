import { HttpException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';

export const OMDB_API_KEY = Symbol('OMDB_API_KEY');
export const OMDB_FAILURES = {
  OMDB_QUOTA_EXHAUSTED: { status: 503, message: 'Media provider daily quota exhausted.' },
  OMDB_UNAVAILABLE: { status: 503, message: 'Media provider unavailable.' },
  OMDB_TIMEOUT: { status: 504, message: 'Media provider timed out.' },
  OMDB_INVALID_RESPONSE: { status: 502, message: 'Media provider returned invalid metadata.' },
} as const;
export type OmdbFailureCode = keyof typeof OMDB_FAILURES;
/** Only predefined messages survive the HTTP error filter. Never attach provider causes. */
export class OmdbError extends HttpException {
  readonly code: OmdbFailureCode;
  constructor(code: OmdbFailureCode) {
    const failure = OMDB_FAILURES[code];
    super({ code, message: failure.message }, failure.status);
    this.code = code;
  }
}
export type OmdbParameters =
  | { s: string; type: 'movie' | 'series'; page: string }
  | { i: string; plot?: 'full'; Season?: string };

@Injectable()
export class OmdbClient {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(OMDB_API_KEY) private readonly apiKey: string) {}

  private async readBody(response: Response): Promise<unknown> {
    if (!response.body) throw new OmdbError('OMDB_INVALID_RESPONSE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512_000) {
          await reader.cancel();
          throw new OmdbError('OMDB_INVALID_RESPONSE');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new OmdbError('OMDB_INVALID_RESPONSE'); }
  }

  private async reserveQuota(): Promise<void> {
    // PostgreSQL decides the UTC day for every instance; the conditional upsert
    // locks the shared row and stops incrementing at 950. Each actual attempt counts.
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" (id, key, count, "lastRequest")
      VALUES (${randomUUID()}, 'omdb:daily', 1,
        floor(extract(epoch FROM date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN "RateLimit"."lastRequest" < floor(extract(epoch FROM date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint
          THEN 1 ELSE "RateLimit".count + 1 END,
        "lastRequest" = floor(extract(epoch FROM date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint
      WHERE "RateLimit".count < 950 OR "RateLimit"."lastRequest" < floor(extract(epoch FROM date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint
      RETURNING count`;
    if (!rows.length) throw new OmdbError('OMDB_QUOTA_EXHAUSTED');
  }

  async request(parameters: OmdbParameters): Promise<Record<string, unknown> | null> {
    await this.reserveQuota();
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('r', 'json');
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new OmdbError('OMDB_TIMEOUT'));
      }, 5000);
    });
    try {
      const operation = async () => {
        const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new OmdbError('OMDB_UNAVAILABLE');
        return this.readBody(response);
      };
      const body = await Promise.race([operation(), deadline]);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OmdbError('OMDB_INVALID_RESPONSE');
      const record = body as Record<string, unknown>;
      if (record.Response === 'False') {
        // A bounded, explicit classification; raw messages never leave this scope.
        const message = typeof record.Error === 'string' ? record.Error.slice(0, 160).trim().toLowerCase() : '';
        if (/^(movie|series|season|episode) not found[!.]?$/.test(message)) return null;
        if (/^(request limit reached|daily request limit reached)[!.]?$/.test(message)) throw new OmdbError('OMDB_QUOTA_EXHAUSTED');
        throw new OmdbError('OMDB_UNAVAILABLE');
      }
      if (record.Response !== 'True') throw new OmdbError('OMDB_INVALID_RESPONSE');
      return record;
    } catch (error) {
      if (controller.signal.aborted) throw new OmdbError('OMDB_TIMEOUT');
      if (error instanceof OmdbError) throw error;
      throw new OmdbError('OMDB_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
}
