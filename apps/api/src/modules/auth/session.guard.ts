import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AUTH, type Auth } from './auth.config.js';

export interface AuthenticatedUser { id: string }
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
    if (!session || !session.user.emailVerified) throw new UnauthorizedException();
    req.user = { id: session.user.id };
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    return true;
  }
}
