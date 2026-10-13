export function validateEnv(input: Record<string, unknown>) {
  const nodeEnv = String(input.NODE_ENV ?? 'development');
  const port = Number(input.PORT ?? 4000);
  const poolMax = Number(input.DB_POOL_MAX ?? 10);
  const accessTtl = Number(input.ACCESS_TOKEN_TTL_SECONDS ?? 900);
  const refreshDays = Number(input.REFRESH_TOKEN_DAYS ?? 30);
  const databaseUrl = String(input.DATABASE_URL ?? '');
  const jwtSecret = String(input.JWT_ACCESS_SECRET ?? '');
  const cookieSecureSetting = String(input.COOKIE_SECURE ?? 'false').toLowerCase();
  const cookieSecure = cookieSecureSetting === 'true' || nodeEnv === 'production';
  const cookieSameSite = String(input.COOKIE_SAME_SITE ?? 'lax').toLowerCase();

  const errors: string[] = [];
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV must be development, test, or production.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer between 1 and 65535.');
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) errors.push('DB_POOL_MAX must be an integer between 1 and 100.');
  if (!Number.isInteger(accessTtl) || accessTtl < 60 || accessTtl > 86400) errors.push('ACCESS_TOKEN_TTL_SECONDS must be between 60 and 86400.');
  if (!Number.isInteger(refreshDays) || refreshDays < 1 || refreshDays > 180) errors.push('REFRESH_TOKEN_DAYS must be between 1 and 180.');
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) errors.push('DATABASE_URL must be a PostgreSQL connection URL.');
  if (jwtSecret.length < 32 || jwtSecret.includes('replace-with')) errors.push('JWT_ACCESS_SECRET must be a strong secret of at least 32 characters.');
  if (!['true', 'false'].includes(cookieSecureSetting)) errors.push('COOKIE_SECURE must be true or false.');
  if (!['lax', 'strict', 'none'].includes(cookieSameSite)) errors.push('COOKIE_SAME_SITE must be lax, strict, or none.');
  if (cookieSameSite === 'none' && !cookieSecure) errors.push('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true (HTTPS).');
  if (errors.length) throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);

  return {
    ...input,
    NODE_ENV: nodeEnv,
    PORT: port,
    DB_POOL_MAX: poolMax,
    ACCESS_TOKEN_TTL_SECONDS: accessTtl,
    REFRESH_TOKEN_DAYS: refreshDays,
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: jwtSecret,
    CORS_ORIGINS: String(input.CORS_ORIGINS ?? 'http://localhost:3000'),
    COOKIE_SECURE: cookieSecure ? 'true' : 'false',
    COOKIE_SAME_SITE: cookieSameSite,
  };
}
