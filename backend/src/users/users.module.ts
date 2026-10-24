import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { VisitedLocationsModule } from '../visited-locations/visited-locations.module';
import { MessagingPolicyModule } from '../messaging/messaging-policy.module';

@Module({ imports: [AuthModule, VisitedLocationsModule, MessagingPolicyModule], controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
