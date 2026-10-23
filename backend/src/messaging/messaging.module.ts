import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingBlocksController, MessagingController } from './messaging.controller';
import { MessagingPolicyService } from './messaging-policy.service';
import { MessagingRateLimitGuard } from './messaging-rate-limit.guard';
import { MessagingService } from './messaging.service';

@Module({
  imports: [AuthModule],
  controllers: [MessagingController, MessagingBlocksController],
  providers: [MessagingService, MessagingPolicyService, MessagingRateLimitGuard],
  exports: [MessagingService],
})
export class MessagingModule {}
