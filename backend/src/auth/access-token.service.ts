import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { AuthenticatedUser } from '../common/interfaces';

export interface VerifiedAccessToken extends AuthenticatedUser { exp: number; }

export class AccessTokenError extends UnauthorizedException {
  constructor(readonly code: 'TOKEN_EXPIRED' | 'UNAUTHORIZED' = 'UNAUTHORIZED') {
    super('Access token is invalid or expired.');
  }
}

/** Shared authentication policy for HTTP and realtime; tokens never leave this service. */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService, private readonly db: DatabaseService) {}

  async verify(token: string): Promise<VerifiedAccessToken> {
    if (typeof token !== 'string' || !token || token.length > 4096) throw new AccessTokenError();
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), algorithms: ['HS256'],
      });
    } catch (error: unknown) {
      throw new AccessTokenError(error instanceof Error && error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED');
    }
    if (typeof payload.sub !== 'string' || !isUUID(payload.sub) || typeof payload.email !== 'string' || !payload.email
      || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp)) throw new AccessTokenError();
    if (payload.exp * 1000 <= Date.now()) throw new AccessTokenError('TOKEN_EXPIRED');

    // Let database failures propagate so HTTP can report outages rather than incorrect 401s.
    await this.assertActive(payload.sub);
    return { sub: payload.sub, email: payload.email, exp: payload.exp };
  }

  async assertActive(userId: string): Promise<void> {
    const result = await this.db.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [userId]);
    if (!result.rows[0]?.is_active) throw new AccessTokenError();
  }
}
