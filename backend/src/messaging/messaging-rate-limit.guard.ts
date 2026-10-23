import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../common/interfaces';

/** Reuse Nest's storage, adding a sender-wide limit across conversations/IPs. */
@Injectable()
export class MessagingRateLimitGuard implements CanActivate {
  constructor(@Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user: AuthenticatedUser }>();
    const result = await this.storage.increment(`messaging:send:${request.user.sub}`, 60_000, 30, 60_000, 'messaging-send');
    if (result.isBlocked) {
      http.getResponse<Response>().setHeader('Retry-After', result.timeToBlockExpire);
      throw new ThrottlerException('Bạn gửi tin quá nhanh. Vui lòng thử lại sau.');
    }
    return true;
  }
}
