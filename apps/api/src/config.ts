export interface ApiConfig {
  databaseUrl: string;
  betterAuthSecret: string;
  omdbApiKey: string;
  frontendOrigin: string;
  port: number;
  smtpPort?: number;
  authBaseUrl?: string;
  proxySharedSecret?: string;
  nodeEnv: 'development' | 'test' | 'production';
}

export class ConfigurationError extends Error {
  constructor(keys: string[]) {
    super(`Invalid backend configuration: ${keys.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

export function validateEnvironment(env: Record<string, string | undefined>): ApiConfig {
  const invalid: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) {
      invalid.push('DATABASE_URL');
    }
  } catch { invalid.push('DATABASE_URL'); }

  const betterAuthSecret = env.BETTER_AUTH_SECRET ?? '';
  const proxySharedSecret = env.PROXY_SHARED_SECRET;
  if (proxySharedSecret !== undefined && proxySharedSecret.trim().length < 32) invalid.push('PROXY_SHARED_SECRET');
  if (betterAuthSecret.trim().length < 32) invalid.push('BETTER_AUTH_SECRET');

  const omdbApiKey = env.OMDB_API_KEY ?? '';
  if (!/^[a-zA-Z0-9_-]+$/.test(omdbApiKey)) invalid.push('OMDB_API_KEY');

  let frontendOrigin = '';
  try {
    const url = new URL(env.FRONTEND_ORIGIN ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      invalid.push('FRONTEND_ORIGIN');
    } else { frontendOrigin = url.origin; }
  } catch { invalid.push('FRONTEND_ORIGIN'); }

  const portString = env.PORT ?? '3001';
  const port = Number(portString);
  if (!/^\d+$/.test(portString) || !Number.isInteger(port) || port < 1 || port > 65535) invalid.push('PORT');

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) invalid.push('NODE_ENV');

  const smtpPort = Number(env.SMTP_PORT ?? '1025');
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) invalid.push('SMTP_PORT');
  const authBaseUrl = env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
  try {
    const url = new URL(authBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (nodeEnv === 'production' && url.protocol !== 'https:')) invalid.push('BETTER_AUTH_URL');
  } catch { invalid.push('BETTER_AUTH_URL'); }
  if (nodeEnv === 'production') invalid.push('EMAIL_PROVIDER (production delivery is not configured)');
  if (invalid.length) throw new ConfigurationError(invalid);
  return { smtpPort, authBaseUrl, proxySharedSecret, databaseUrl, betterAuthSecret, omdbApiKey, frontendOrigin, port, nodeEnv: nodeEnv as ApiConfig['nodeEnv'] };
}
