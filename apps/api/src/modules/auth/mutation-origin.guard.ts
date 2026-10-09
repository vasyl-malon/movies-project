import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH, type Auth } from './auth.config.js';
import { PROXY_CONFIG, trustedClientIp } from '../../common/proxy-trust.js';
@Injectable()
export class MutationOriginGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth, @Inject(PROXY_CONFIG) private readonly proxySecret: string | null) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    try { trustedClientIp(req, this.proxySecret ?? undefined); } catch { throw new ForbiddenException(); }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.headers.origin || !(this.auth.options.trustedOrigins as string[]).includes(req.headers.origin)) throw new ForbiddenException();
    }
    return true;
  }
}
