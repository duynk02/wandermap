import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { DatabaseService } from '../database/database.service';
import { AccessTokenError, AccessTokenService } from './access-token.service';

describe('Shared access token policy (HTTP and realtime)', () => {
  const secret = 'access-token-test-secret-with-at-least-32-characters';
  const identity = { sub: '11111111-1111-4111-8111-111111111111', email: 'test@example.com' };
  const jwt = new JwtService({ secret });
  const query = jest.fn();
  const service = new AccessTokenService(jwt, new ConfigService({ JWT_ACCESS_SECRET: secret }), { query } as unknown as DatabaseService);

  beforeEach(() => { query.mockReset().mockResolvedValue({ rows: [{ is_active: true }] }); });

  it('verifies a signed, expiring token and checks the server-side user', async () => {
    const user = await service.verify(jwt.sign(identity, { expiresIn: 60 }));
    expect(user).toMatchObject(identity);
    expect(user.exp).toBeGreaterThan(Date.now() / 1000);
    expect(query).toHaveBeenCalledWith('SELECT is_active FROM users WHERE id = $1', [identity.sub]);
  });

  it.each([
    ['missing', ''], ['oversized', 'x'.repeat(4097)], ['malformed', 'not-a-jwt'],
    ['forged', new JwtService({ secret: 'another-test-secret' }).sign(identity, { expiresIn: 60 })],
    ['no expiry', jwt.sign(identity)],
    ['no subject', jwt.sign({ email: identity.email }, { expiresIn: 60 })],
    ['invalid subject', jwt.sign({ ...identity, sub: 'not-a-uuid' }, { expiresIn: 60 })],
    ['invalid email', jwt.sign({ ...identity, email: 123 }, { expiresIn: 60 })],
    ['wrong algorithm', jwt.sign(identity, { expiresIn: 60, algorithm: 'HS384' })],
    ['not active yet', jwt.sign(identity, { expiresIn: 60, notBefore: 30 })],
  ])('rejects %s credentials without querying the database', async (_label, token) => {
    await expect(service.verify(token)).rejects.toBeInstanceOf(AccessTokenError);
    expect(query).not.toHaveBeenCalled();
  });

  it('reports expiry separately for bounded realtime refresh', async () => {
    await expect(service.verify(jwt.sign(identity, { expiresIn: -1 }))).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ is_active: false }] }])('rejects missing/inactive users', async ({ rows }) => {
    query.mockResolvedValue({ rows });
    await expect(service.verify(jwt.sign(identity, { expiresIn: 60 }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('preserves database outages for the HTTP exception filter', async () => {
    const error = new Error('test database unavailable');
    query.mockRejectedValue(error);
    await expect(service.verify(jwt.sign(identity, { expiresIn: 60 }))).rejects.toBe(error);
  });

  function httpContext(authorization?: string) {
    const request = { headers: { authorization }, user: undefined as unknown };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { request, context };
  }

  it('keeps optional HTTP authentication anonymous only without credentials', async () => {
    const guard = new OptionalAccessTokenGuard(service);
    await expect(guard.canActivate(httpContext().context)).resolves.toBe(true);
    await expect(guard.canActivate(httpContext('Basic test').context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([AccessTokenGuard, OptionalAccessTokenGuard])('applies the shared verifier in %p', async (Guard) => {
    const guard = new Guard(service);
    const { request, context } = httpContext(`Bearer ${jwt.sign(identity, { expiresIn: 60 })}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(identity);
    await expect(guard.canActivate(httpContext('Bearer invalid').context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires bearer credentials on protected HTTP routes', async () => {
    await expect(new AccessTokenGuard(service).canActivate(httpContext().context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
