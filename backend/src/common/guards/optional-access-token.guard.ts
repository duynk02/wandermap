import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenService } from '../../auth/access-token.service';
import { AuthenticatedUser } from '../interfaces';

@Injectable()
export class OptionalAccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const authorization = request.headers.authorization;
    if (!authorization) return true;
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Access token is invalid.');

    const payload = await this.accessTokens.verify(token);
    request.user = { sub: payload.sub, email: payload.email };
    return true;
  }
}
