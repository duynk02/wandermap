import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

describe('production refresh cookie contract', () => {
  it('sets and clears host-only HttpOnly cookies with the same path and security policy', async () => {
    const expiry = new Date(Date.now() + 60_000);
    const auth = { login: jest.fn().mockResolvedValue({ accessToken: 'access-fixture', refreshToken: 'refresh-fixture', refreshExpiresAt: expiry }), logout: jest.fn() };
    const controller = new AuthController(auth as unknown as AuthService, new ConfigService({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com', COOKIE_SAME_SITE: 'lax' }));
    const response = { cookie: jest.fn(), clearCookie: jest.fn() };
    const req = { headers: { origin: 'https://app.example.com' }, cookies: { wandermap_refresh: 'refresh-fixture' } } as unknown as Request;
    const result = await controller.login({ email: 'test@example.com', password: 'fixture-password' }, req, response as unknown as Response);
    expect(result).not.toHaveProperty('refreshToken');
    expect(response.cookie).toHaveBeenCalledWith('wandermap_refresh', 'refresh-fixture', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth', expires: expiry });
    await controller.logout(req, response as unknown as Response);
    expect(response.clearCookie).toHaveBeenCalledWith('wandermap_refresh', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth' });
  });
});
