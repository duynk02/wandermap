import { validateEnv } from './validate-env';

describe('validateEnv', () => {
  const baseEnv = {
    NODE_ENV: 'test', PORT: '4000', DB_POOL_MAX: '10', ACCESS_TOKEN_TTL_SECONDS: '900',
    REFRESH_TOKEN_DAYS: '30', DATABASE_URL: 'postgresql://user:pass@localhost:5432/wandermap',
    JWT_ACCESS_SECRET: 'a-valid-test-secret-with-at-least-32-characters', CORS_ORIGINS: 'http://localhost:3000',
  };

  it('normalizes supported environment values', () => {
    const result = validateEnv(baseEnv);
    expect(result.PORT).toBe(4000);
    expect(result.DB_POOL_MAX).toBe(10);
    expect(result.NODE_ENV).toBe('test');
  });

  it('rejects an invalid database URL', () => {
    expect(() => validateEnv({ ...baseEnv, DATABASE_URL: 'sqlite://local' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a weak JWT secret', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'weak' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects invalid cookie security configuration', () => {
    expect(() => validateEnv({ ...baseEnv, COOKIE_SECURE: 'sometimes' })).toThrow(/COOKIE_SECURE/);
    expect(() => validateEnv({ ...baseEnv, COOKIE_SAME_SITE: 'none' })).toThrow(/COOKIE_SAME_SITE=none/);
  });

  it('uses defaults for blank optional values without weakening required validation', () => {
    const result = validateEnv({ ...baseEnv, DB_POOL_MAX: '', ACCESS_TOKEN_TTL_SECONDS: ' ', REFRESH_TOKEN_DAYS: '', COOKIE_SAME_SITE: '' });
    expect([result.DB_POOL_MAX, result.ACCESS_TOKEN_TTL_SECONDS, result.REFRESH_TOKEN_DAYS, result.COOKIE_SAME_SITE]).toEqual([10, 900, 30, 'lax']);
    expect(() => validateEnv({ ...baseEnv, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('requires exact public HTTPS origins and secure cookies in production', () => {
    const production = { ...baseEnv, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com',
      PUBLIC_API_URL: 'https://api.example.com/api/v1', CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'unit-key', CLOUDINARY_API_SECRET: 'unit-secret' };
    expect(validateEnv(production).COOKIE_SECURE).toBe('true');
    expect(validateEnv(production).SWAGGER_ENABLED).toBe('false');
    expect(validateEnv(production).LOG_LEVEL).toBe('log,warn,error');
    for (const origin of ['', '*', 'https://*.vercel.app', 'http://app.example.com', 'https://localhost', 'https://app.example.com/path']) {
      expect(() => validateEnv({ ...production, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
    }
    expect(() => validateEnv({ ...production, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => validateEnv({ ...production, PGSSLMODE: 'disable' })).toThrow(/PGSSLMODE/);
    expect(() => validateEnv({ ...production, STORAGE_PROVIDER: 'local' })).toThrow(/STORAGE_PROVIDER/);
    expect(() => validateEnv({ ...production, SERVE_LEGACY_UPLOADS: 'true' })).toThrow(/SERVE_LEGACY_UPLOADS/);
    expect(() => validateEnv({ ...production, CLOUDINARY_API_SECRET: '' })).toThrow(/CLOUDINARY_API_SECRET/);
  });

  it('accepts explicit proxy CIDRs and rejects booleans, hop counts and universal networks', () => {
    expect(validateEnv({ ...baseEnv, TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128' }).TRUSTED_PROXY_CIDRS).toBe('127.0.0.1/32,::1/128');
    for (const proxy of ['true', '1', '*', '0.0.0.0/0', '::/0', '127.0.0.1/99']) {
      expect(() => validateEnv({ ...baseEnv, TRUSTED_PROXY_CIDRS: proxy })).toThrow(/TRUSTED_PROXY_CIDRS/);
    }
  });

  it('does not echo credentials or malformed URLs in errors', () => {
    const secret = 'do-not-print-this-password';
    try { validateEnv({ ...baseEnv, DATABASE_URL: `bad://${secret}`, UPLOAD_PUBLIC_URL: `https://user:${secret}@example.com` }); fail('Expected validation failure'); }
    catch (error) { expect(String(error)).not.toContain(secret); }
  });
});
