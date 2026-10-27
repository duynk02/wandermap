import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service';
import { NotificationsListener } from '../src/notifications/notifications.listener';

describe('WanderMap API health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The health endpoint's database dependency is deliberately stubbed here. Real PostgreSQL/PostGIS
    // behavior belongs in a separate integration suite using an isolated database.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '4000',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/wandermap_test',
      JWT_ACCESS_SECRET: 'e2e-test-secret-that-is-long-enough-for-validation',
      CORS_ORIGINS: 'http://localhost:3000',
      COOKIE_SECURE: 'false',
      COOKIE_SAME_SITE: 'lax',
    });

    // Configure fixtures before ConfigModule validates; never read application .env in tests.
    const { AppModule } = await import('../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ check: jest.fn().mockResolvedValue({ connected: true, latencyMs: 1 }) })
      .overrideProvider(NotificationsListener)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns an API health response when the database check succeeds', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('ok');
        expect(response.body.dependencies.database.status).toBe('ok');
        expect(response.body.dependencies.database.connected).toBe(true);
      });
  });
});
