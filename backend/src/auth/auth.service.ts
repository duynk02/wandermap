import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface UserRow {
  id: string; email: string; is_active: boolean; username: string; display_name: string;
  avatar_url: string | null; bio: string | null; home_city: string | null; country_count: number; total_posts: number;
  followers_count: number; following_count: number; created_at: Date;
}
interface SessionRow { id: string; user_id: string; token_hash: string; expires_at: Date; revoked_at: Date | null; replaced_by_session_id: string | null; is_active: boolean; email: string; }

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(private readonly db: DatabaseService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async register(dto: RegisterDto, metadata: { userAgent?: string; ip?: string }) {
    const email = dto.email.trim().toLowerCase();
    if (Buffer.byteLength(dto.password, 'utf8') > 72) throw new BadRequestException('Password must not exceed 72 UTF-8 bytes.');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const profile = await this.db.transaction(async (client) => {
      const userResult = await client.query<{ id: string; email: string }>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, passwordHash],
      ).catch((error: any) => {
        if (error?.code === '23505') throw new ConflictException('An account with this email already exists.');
        throw error;
      });
      const user = userResult.rows[0];
      const requested = this.normalizeUsername(dto.username ?? email.split('@')[0]);
      const username = await this.uniqueUsername(client, requested);
      const displayName = dto.display_name?.trim() || email.split('@')[0];
      const profileResult = await client.query<UserRow>(
        `INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $3)
         RETURNING id, username, display_name, avatar_url, bio, home_city, country_count, total_posts, followers_count, following_count, created_at`,
        [user.id, username, displayName],
      );
      return { ...profileResult.rows[0], email: user.email };
    });

    const tokens = await this.createSession(profile.id, profile.email, metadata);
    return { ...tokens, user: profile };
  }

  async login(dto: LoginDto, metadata: { userAgent?: string; ip?: string }) {
    const result = await this.db.query<UserRow & { password_hash: string | null }>(
      `SELECT u.id, u.email, u.password_hash, u.is_active, p.username, p.display_name, p.avatar_url, p.bio, p.home_city,
              p.country_count, p.total_posts, p.followers_count, p.following_count, p.created_at
       FROM users u JOIN profiles p ON p.id = u.id WHERE lower(u.email) = lower($1) LIMIT 1`, [dto.email.trim()],
    );
    const row = result.rows[0];
    const validPassword = dto.password && Buffer.byteLength(dto.password, 'utf8') <= 72 && row?.password_hash
      ? await bcrypt.compare(dto.password, row.password_hash) : false;
    if (!row || !validPassword || !row.is_active) throw new UnauthorizedException('Email or password is incorrect.');
    await this.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
    const tokens = await this.createSession(row.id, row.email, metadata);
    const { password_hash: _passwordHash, is_active: _isActive, ...user } = row;
    return { ...tokens, user };
  }

  async refresh(refreshToken: string, metadata: { userAgent?: string; ip?: string }) {
    if (!refreshToken || refreshToken.length > 512) throw new UnauthorizedException('Refresh session is invalid or expired.');
    const tokenHash = this.hashToken(refreshToken);
    const rotated = await this.db.transaction(async (client) => {
      const sessionResult = await client.query<SessionRow>(
        `SELECT s.id, s.user_id, s.token_hash, s.expires_at, s.revoked_at, s.replaced_by_session_id, u.is_active, u.email
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 FOR UPDATE OF s`, [tokenHash],
      );
      const session = sessionResult.rows[0];
      if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || !session.is_active) {
        const replayDetected = Boolean(session?.revoked_at && session.replaced_by_session_id);
        return { invalid: true as const, userId: session?.user_id, replayDetected };
      }
      const rawRefreshToken = randomBytes(48).toString('base64url');
      const days = this.config.get<number>('REFRESH_TOKEN_DAYS', 30);
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const newSession = await client.query<{ id: string }>(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5::inet) RETURNING id`,
        [session.user_id, this.hashToken(rawRefreshToken), expiresAt, metadata.userAgent?.slice(0, 500) ?? null, metadata.ip ?? null],
      );
      await client.query('UPDATE auth_sessions SET revoked_at = now(), replaced_by_session_id = $2 WHERE id = $1', [session.id, newSession.rows[0].id]);
      return { userId: session.user_id, email: session.email, rawRefreshToken, expiresAt };
    });
    if ('invalid' in rotated) {
      if (rotated.replayDetected && rotated.userId) {
        await this.db.query('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1', [rotated.userId]);
      }
      throw new UnauthorizedException('Refresh session is invalid or expired. Please log in again.');
    }
    return {
      accessToken: await this.signAccessToken(rotated.userId, rotated.email),
      refreshToken: rotated.rawRefreshToken,
      refreshExpiresAt: rotated.expiresAt,
      tokenType: 'Bearer',
      expiresIn: this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS', 900),
    };
  }

  async logout(refreshToken?: string) {
    if (refreshToken && refreshToken.length <= 512) {
      await this.db.query('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1', [this.hashToken(refreshToken)]);
    }
    return { success: true };
  }

  async me(userId: string) {
    const result = await this.db.query<UserRow & { email: string }>(
      `SELECT p.id, u.email, p.username, p.display_name, p.avatar_url, p.bio, p.home_city, p.country_count, p.total_posts,
              p.followers_count, p.following_count, p.created_at
       FROM profiles p JOIN users u ON u.id = p.id WHERE p.id = $1 AND u.is_active = true`, [userId],
    );
    if (!result.rows[0]) throw new UnauthorizedException('Account is unavailable.');
    return result.rows[0];
  }

  private async createSession(userId: string, email: string, metadata: { userAgent?: string; ip?: string }) {
    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get<number>('REFRESH_TOKEN_DAYS', 30);
    const refreshExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.db.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5::inet)`,
      [userId, this.hashToken(refreshToken), refreshExpiresAt, metadata.userAgent?.slice(0, 500) ?? null, metadata.ip ?? null],
    );
    return {
      accessToken: await this.signAccessToken(userId, email), refreshToken, refreshExpiresAt,
      tokenType: 'Bearer', expiresIn: this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS', 900),
    };
  }

  private signAccessToken(userId: string, email: string) {
    const ttl = this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS', 900);
    return this.jwt.signAsync({ sub: userId, email }, { expiresIn: ttl });
  }

  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private normalizeUsername(value: string) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    return normalized.length >= 3 ? normalized : `user_${normalized}`.slice(0, 30);
  }
  private async uniqueUsername(client: PoolClient, base: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = attempt === 0 ? base : `${base.slice(0, 24)}_${randomBytes(3).toString('hex')}`.slice(0, 30);
      const exists = await client.query('SELECT 1 FROM profiles WHERE lower(username) = lower($1)', [candidate]);
      if (exists.rowCount === 0) return candidate;
    }
    this.logger.error('Could not generate a unique username after 8 attempts');
    throw new ConflictException('Could not allocate a username. Please choose one explicitly.');
  }
}
