import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_COOKIE = 'wandermap_refresh';
type ClientRequest = Request & { cookies?: Record<string, string | undefined> };

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an account using email and password' })
  async register(@Body() dto: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    const result = await this.auth.register(dto, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    const { refreshToken: _refreshToken, refreshExpiresAt: _refreshExpiresAt, ...body } = result;
    return body;
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    const result = await this.auth.login(dto, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    const { refreshToken: _refreshToken, refreshExpiresAt: _refreshExpiresAt, ...body } = result;
    return body;
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the HttpOnly refresh cookie and issue a new access token' })
  async refresh(@Req() request: ClientRequest, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    const result = await this.auth.refresh(request.cookies?.[REFRESH_COOKIE] ?? '', this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    const { refreshToken: _refreshToken, refreshExpiresAt: _refreshExpiresAt, ...body } = result;
    return body;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current refresh session' })
  async logout(@Req() request: ClientRequest, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    await this.auth.logout(request.cookies?.[REFRESH_COOKIE]);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  // @Get('me')
  // @UseGuards(AccessTokenGuard)
  // @HttpCode(HttpStatus.OK)
  // @ApiBearerAuth()
  // @ApiOperation({ summary: 'Return the authenticated profile' })
  // me(@CurrentUser() user: AuthenticatedUser) { return this.auth.me(user.sub); }

  private metadata(request: Request) {
    return { userAgent: request.headers['user-agent'], ip: request.ip };
  }

  private assertTrustedOrigin(request: Request) {
    const origin = request.headers.origin;
    if (!origin) return; // Native clients and server-to-server callers may not send Origin.
    const allowlist = this.config.get<string>('CORS_ORIGINS', 'http://localhost:3000')
      .split(',').map((value) => value.trim()).filter(Boolean);
    if (!allowlist.includes(origin)) throw new ForbiddenException('Request origin is not allowed.');
  }

  private cookieOptions() {
    const secure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true' || this.config.get<string>('NODE_ENV') === 'production';
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE', 'lax');
    return { httpOnly: true, secure, sameSite, path: '/api/v1/auth' };
  }

  private setRefreshCookie(response: Response, token: string, expiresAt: Date) {
    response.cookie(REFRESH_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
  }
}
