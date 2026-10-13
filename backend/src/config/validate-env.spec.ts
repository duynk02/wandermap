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
});
