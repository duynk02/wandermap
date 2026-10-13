import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, OptionalAccessTokenGuard],
  exports: [AuthService, AccessTokenGuard, OptionalAccessTokenGuard, JwtModule],
})
export class AuthModule {}
