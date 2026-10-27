import { isIP } from 'node:net';
import { databaseConnectionOptions } from '../database/connection-options';

const value = (input: Record<string, unknown>, key: string, fallback = '') => String(input[key] ?? '').trim() || fallback;
const loopback = (hostname: string) => /^(localhost|0\.0\.0\.0|127\..*|\[::1\])$/i.test(hostname) || hostname.endsWith('.localhost');

export function validateEnv(input: Record<string, unknown>) {
  const nodeEnv = value(input, 'NODE_ENV', 'development');
  const production = nodeEnv === 'production';
  const port = Number(value(input, 'PORT', '4000'));
  const poolMax = Number(value(input, 'DB_POOL_MAX', '10'));
  const accessTtl = Number(value(input, 'ACCESS_TOKEN_TTL_SECONDS', '900'));
  const refreshDays = Number(value(input, 'REFRESH_TOKEN_DAYS', '30'));
  const databaseUrl = value(input, 'DATABASE_URL');
  const jwtSecret = value(input, 'JWT_ACCESS_SECRET');
  const cookieSecureSetting = value(input, 'COOKIE_SECURE', production ? 'true' : 'false').toLowerCase();
  const cookieSecure = cookieSecureSetting === 'true' || production;
  const cookieSameSite = value(input, 'COOKIE_SAME_SITE', 'lax').toLowerCase();
  const corsOrigins = value(input, 'CORS_ORIGINS', production ? '' : 'http://localhost:3000');
  const trustedProxyCidrs = value(input, 'TRUSTED_PROXY_CIDRS');
  const pgSslMode = value(input, 'PGSSLMODE');
  const storageProvider = value(input, 'STORAGE_PROVIDER', production ? 'cloudinary' : 'local');
  const publicApiUrl = value(input, 'PUBLIC_API_URL', production ? '' : 'http://localhost:4000/api/v1');
  const serveLegacy = value(input, 'SERVE_LEGACY_UPLOADS', production ? 'false' : 'true');
  const swaggerEnabled = value(input, 'SWAGGER_ENABLED', production ? 'false' : 'true').toLowerCase();
  const logLevels = value(input, 'LOG_LEVEL', production ? 'log,warn,error' : 'log,warn,error,debug').split(',').map((level) => level.trim()).filter(Boolean);
  const errors: string[] = [];

  function httpUrl(key: string, raw: string, required = false, originOnly = false): URL | undefined {
    if (!raw) { if (required) errors.push(`${key} is required.`); return; }
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname.includes('*') || url.username || url.password || url.search || url.hash
        || (originOnly && raw !== url.origin) || (production && (url.protocol !== 'https:' || loopback(url.hostname)))) throw new Error();
      return url;
    } catch { errors.push(`${key} must be a valid ${production ? 'public HTTPS' : 'HTTP(S)'} ${originOnly ? 'origin without a path' : 'URL'} without credentials, query or fragment.`); }
  }

  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV must be development, test, or production.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer between 1 and 65535.');
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) errors.push('DB_POOL_MAX must be an integer between 1 and 100.');
  if (!Number.isInteger(accessTtl) || accessTtl < 60 || accessTtl > 86400) errors.push('ACCESS_TOKEN_TTL_SECONDS must be between 60 and 86400.');
  if (!Number.isInteger(refreshDays) || refreshDays < 1 || refreshDays > 180) errors.push('REFRESH_TOKEN_DAYS must be between 1 and 180.');
  try {
    databaseConnectionOptions(databaseUrl, pgSslMode, production);
  } catch { errors.push('DATABASE_URL/PGSSLMODE must be valid PostgreSQL configuration without unsafe TLS overrides.'); }
  if (jwtSecret.length < 32 || /replace-with|your-secret/i.test(jwtSecret)) errors.push('JWT_ACCESS_SECRET must be a strong secret of at least 32 characters.');
  if (!['true', 'false'].includes(cookieSecureSetting)) errors.push('COOKIE_SECURE must be true or false.');
  if (production && cookieSecureSetting === 'false') errors.push('COOKIE_SECURE must be true in production.');
  if (!['lax', 'strict', 'none'].includes(cookieSameSite)) errors.push('COOKIE_SAME_SITE must be lax, strict, or none.');
  if (cookieSameSite === 'none' && !cookieSecure) errors.push('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true (HTTPS).');
  const origins = corsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) errors.push('CORS_ORIGINS must contain at least one allowed origin.');
  origins.forEach((origin) => httpUrl('CORS_ORIGINS', origin, true, true));
  if (!['', 'require', 'verify-full', 'disable'].includes(pgSslMode) || (production && pgSslMode === 'disable')) errors.push('PGSSLMODE is invalid; production cannot disable TLS.');
  for (const cidr of trustedProxyCidrs.split(',').map((part) => part.trim()).filter(Boolean)) {
    const [address, mask, ...extra] = cidr.split('/');
    const family = isIP(address);
    const bits = Number(mask);
    if (!family || extra.length || mask === undefined || !Number.isInteger(bits) || bits < 1 || bits > (family === 4 ? 32 : 128)) errors.push('TRUSTED_PROXY_CIDRS must contain explicit non-universal IPv4/IPv6 CIDRs, not booleans or hop counts.');
  }
  httpUrl('UPLOAD_PUBLIC_URL', value(input, 'UPLOAD_PUBLIC_URL'));
  httpUrl('PHOTON_URL', value(input, 'PHOTON_URL'));
  const publicApi = httpUrl('PUBLIC_API_URL', publicApiUrl, true);
  if (publicApi && publicApi.pathname.replace(/\/$/, '') !== '/api/v1') errors.push('PUBLIC_API_URL must end in /api/v1.');
  if (!['local', 'cloudinary'].includes(storageProvider) || (production && storageProvider !== 'cloudinary')) errors.push('STORAGE_PROVIDER must be local or cloudinary; production requires cloudinary.');
  if (!['true', 'false'].includes(serveLegacy) || (production && serveLegacy !== 'false')) errors.push('SERVE_LEGACY_UPLOADS must be false in production.');
  if (!['true', 'false'].includes(swaggerEnabled)) errors.push('SWAGGER_ENABLED must be true or false.');
  if (!logLevels.length || logLevels.some((level) => !['log', 'warn', 'error', 'debug', 'verbose', 'fatal'].includes(level))) errors.push('LOG_LEVEL must contain supported Nest log levels.');
  if (storageProvider === 'cloudinary') {
    if (!/^[a-z0-9_-]+$/i.test(value(input, 'CLOUDINARY_CLOUD_NAME'))) errors.push('CLOUDINARY_CLOUD_NAME is required and must be a cloud name.');
    for (const key of ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) if (!value(input, key)) errors.push(`${key} is required for cloudinary storage.`);
  }
  if (errors.length) throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  return {
    ...input, NODE_ENV: nodeEnv, PORT: port, DB_POOL_MAX: poolMax, ACCESS_TOKEN_TTL_SECONDS: accessTtl,
    REFRESH_TOKEN_DAYS: refreshDays, DATABASE_URL: databaseUrl, JWT_ACCESS_SECRET: jwtSecret,
    CORS_ORIGINS: [...new Set(origins)].join(','), COOKIE_SECURE: cookieSecure ? 'true' : 'false',
    COOKIE_SAME_SITE: cookieSameSite, TRUSTED_PROXY_CIDRS: trustedProxyCidrs, PGSSLMODE: pgSslMode,
    STORAGE_PROVIDER: storageProvider, PUBLIC_API_URL: publicApiUrl.replace(/\/+$/, ''), SERVE_LEGACY_UPLOADS: serveLegacy,
    SWAGGER_ENABLED: swaggerEnabled, LOG_LEVEL: [...new Set(logLevels)].join(','),
  };
}
