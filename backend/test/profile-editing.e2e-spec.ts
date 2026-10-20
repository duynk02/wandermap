import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../src/common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../src/common/guards/optional-access-token.guard';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { DatabaseService } from '../src/database/database.service';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';

describe('Profile editing HTTP pipeline (mock database)', () => {
  let app: INestApplication;
  let token: string;
  let expiredToken: string;
  const userId = '11111111-1111-4111-8111-111111111111';
  const profile = { id: userId, username: 'traveler', display_name: 'Traveler', bio: null, avatar_url: null, home_city: null };
  const db = { query: jest.fn() };

  beforeAll(async () => {
    const secret = 'profile-e2e-secret-used-only-in-isolated-tests';
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })],
      controllers: [UsersController],
      providers: [UsersService, AccessTokenGuard, OptionalAccessTokenGuard,
        { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    const jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: userId, email: 'profile-test@example.invalid' }, { expiresIn: 300 });
    expiredToken = await jwt.signAsync({ sub: userId, email: 'profile-test@example.invalid' }, { expiresIn: -1 });
  });

  beforeEach(() => {
    db.query.mockReset().mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT is_active') ? [{ is_active: true }] : [profile],
    }));
  });

  afterAll(async () => { await app?.close(); });

  const patch = () => request(app.getHttpServer()).patch('/api/v1/users/me').auth(token, { type: 'bearer' });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).patch('/api/v1/users/me').send({ display_name: 'Changed' }).expect(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects an expired access token', async () => {
    await request(app.getHttpServer()).patch('/api/v1/users/me').auth(expiredToken, { type: 'bearer' }).send({ bio: 'Changed' }).expect(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts', async () => {
    db.query.mockResolvedValue({ rows: [{ is_active: false }] });
    await patch().send({ bio: 'Changed' }).expect(401);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it.each(['id', 'role', 'password', 'email', 'website', 'cover_url'])('rejects the forbidden field %s', async (field) => {
    await patch().send({ display_name: 'Changed', [field]: 'forbidden' }).expect(400);
    expect(db.query).toHaveBeenCalledTimes(1); // Guard only; no UPDATE.
  });

  it.each([
    { display_name: '   ' }, { display_name: null }, { display_name: 'x'.repeat(81) },
    { username: null }, { username: 'ab' }, { username: 'x'.repeat(31) }, { username: 'bad-name' },
    { bio: 'x'.repeat(501) }, { home_city: 'x'.repeat(121) },
    { avatar_url: 'javascript:alert(1)' }, { avatar_url: 'not-a-url' },
  ])('rejects invalid profile input %#', async (input) => {
    await patch().send(input).expect(400);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('accepts exact length limits and preserves the authenticated ID', async () => {
    await patch().send({ username: 'x'.repeat(30), display_name: 'x'.repeat(80), bio: 'x'.repeat(500), home_city: 'x'.repeat(120) }).expect(200);
    expect(db.query.mock.calls[1][1][0]).toBe(userId);
  });

  it('trims names and clears optional whitespace before persisting', async () => {
    await patch().send({ display_name: '  Quốc Anh  ', bio: '   ', home_city: '   ' }).expect(200);
    expect(db.query.mock.calls[1][1]).toEqual([userId, 'Quốc Anh', null, null]);
  });

  it.each(['http://localhost:4000/uploads/avatar.webp', null])('accepts uploaded local avatar URLs and avatar removal: %s', async (avatar_url) => {
    await patch().send({ avatar_url }).expect(200);
    expect(db.query.mock.calls[1][1]).toEqual([userId, avatar_url]);
  });

  it('returns a specific username conflict through the standard error filter', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT is_active')) return { rows: [{ is_active: true }] };
      throw { code: '23505', constraint: 'profiles_username_lower_unique' };
    });
    const response = await patch().send({ username: 'taken_name' }).expect(409);
    expect(response.body).toMatchObject({ statusCode: 409, code: 'USERNAME_TAKEN', path: '/api/v1/users/me' });
    expect(response.body).not.toHaveProperty('constraint');
  });

  it('rejects an empty update', async () => { await patch().send({}).expect(400); });
});
