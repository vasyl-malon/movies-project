import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { createHash } from 'node:crypto';
import { AUTH, type Auth } from './auth.config.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { PROXY_CONFIG, trustedClientIp } from '../../common/proxy-trust.js';

@Controller('api/auth')
export class AuthController {
  private readonly handler;
  private readonly trustedOrigins: string[];
  constructor(@Inject(AUTH) auth: Auth, @Inject(RateLimitService) private readonly limits: RateLimitService, @Inject(PROXY_CONFIG) private readonly proxySecret: string | null) { this.handler = toNodeHandler(auth); this.trustedOrigins = auth.options.trustedOrigins as string[]; }
  @All('*path')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    let ip: string;
    try { ip = trustedClientIp(req, this.proxySecret ?? undefined); }
    catch { res.status(403).json({ message: 'Invalid proxy authentication' }); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.headers.origin || !this.trustedOrigins.includes(req.headers.origin)) { res.status(403).json({ message: 'Invalid origin' }); return; }
      if (!await this.limits.consume(`auth-ip:${ip}`, 10, 60)) { res.status(429).json({ message: 'Too many requests' }); return; }
      const path = req.path.split('/').at(-1);
      if (['email', 'request-password-reset', 'send-verification-email'].includes(path ?? '') && typeof req.body?.email === 'string'
        && (path !== 'email' || req.path.includes('/sign-up/'))) {
        const key = createHash('sha256').update(req.body.email.trim().toLowerCase()).digest('hex');
        if (!await this.limits.consume(`auth-email:${key}`, 3, 900)) { res.status(429).json({ message: 'Too many requests' }); return; }
      }
    }
    delete req.headers['x-forwarded-proto'];
    delete req.headers['x-forwarded-host'];
    await this.handler(req, res);
  }
}
