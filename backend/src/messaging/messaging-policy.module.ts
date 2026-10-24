import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingEventPublisher } from './messaging-events.publisher';
import { MessagingPolicyService } from './messaging-policy.service';

/** Share relationship policy/events without importing messaging HTTP/rate-limit infrastructure. */
@Module({
  imports: [RealtimeModule],
  providers: [MessagingPolicyService, MessagingEventPublisher],
  exports: [MessagingPolicyService, MessagingEventPublisher],
})
export class MessagingPolicyModule {}
