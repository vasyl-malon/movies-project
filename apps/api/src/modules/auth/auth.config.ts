import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { username } from 'better-auth/plugins';
import { randomUUID } from 'node:crypto';
import type { ApiConfig } from '../../config.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { EmailService } from '../email/email.service.js';

export function createAuth(config: ApiConfig, db: PrismaService, email: EmailService): ReturnType<typeof betterAuth> {
  const options: BetterAuthOptions = {
    baseURL: config.authBaseUrl ?? `http://localhost:${config.port}`,
    disabledPaths: ['/is-username-available', '/sign-in/username'],
    basePath: '/api/auth', secret: config.betterAuthSecret,
    trustedOrigins: [config.frontendOrigin],
    database: prismaAdapter(db, { provider: 'postgresql', transaction: true }),
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => { await email.send({ to: user.email, subject: 'Reset your password', text: `Reset your password: ${url}` }); },
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => { await email.send({ to: user.email, subject: 'Verify your email', text: `Verify your email: ${url}` }); },
    },
    session: { cookieCache: { enabled: false } },
    user: { additionalFields: { avatar: { type: 'string', required: false, input: false } } },
    plugins: [username({ displayUsername: false })],
    rateLimit: { enabled: false }, // Atomic persistent limits are applied before the Node handler.
    advanced: { disableCSRFCheck: false, disableOriginCheck: false, database: { generateId: () => randomUUID() }, useSecureCookies: config.nodeEnv === 'production', ipAddress: { disableIpTracking: true } },
    logger: { disabled: true },
  };
  return betterAuth(options);
}
export type Auth = ReturnType<typeof createAuth>;
export const AUTH = Symbol('AUTH');
