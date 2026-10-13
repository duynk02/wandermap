import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DatabaseService } from '../../database/database.service';
import { AuthenticatedUser } from '../interfaces';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService, private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('A valid access token is required.');

    let payload: AuthenticatedUser;
    try {
      payload = await this.jwt.verifyAsync<AuthenticatedUser>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      if (!payload.sub || !payload.email) throw new Error('Invalid token claims');
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }

    // Keep database failures distinct from token failures: the global exception filter can report outages accurately.
    const result = await this.db.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [payload.sub]);
    if (!result.rows[0]?.is_active) throw new UnauthorizedException('Account is unavailable.');
    request.user = { sub: payload.sub, email: payload.email };
    return true;
  }
}
