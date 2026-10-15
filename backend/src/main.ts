import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import {UploadsService} from './uploads/uploads.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true});
  const config = app.get(ConfigService);
  app.enableShutdownHooks();
  const origins = config.get<string>('CORS_ORIGINS', 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);

  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'self'"], frameAncestors: ["'none'"],
    } },
  }));
  app.use(cookieParser());
  app.use((request: any, response: any, next: () => void) => {
    const incoming = request.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  });
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || origins.includes(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by CORS.'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });


// Uploaded images. Files are named by content hash, so they can be cached forever. helmet defaults to
// Cross-Origin-Resource-Policy: same-origin, which would block <img> tags on the web app's origin.
app.useStaticAssets(app.get(UploadsService).rootDir, {
  prefix: '/uploads',
  index: false,
  dotfiles: 'deny',
  maxAge: '365d',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
})

  app.setGlobalPrefix('api/v1');
  // The global prefix is explicitly versioned as /api/v1. Do not also enable URI versioning,
  // which would accidentally produce /api/v1/v1 routes.
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transformOptions: { enableImplicitConversion: false },
  }));
  app.useGlobalFilters(new ApiExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('WanderMap API')
    .setDescription('REST API for the WanderMap travel discovery and social application.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json', swaggerOptions: { persistAuthorization: true } });

  const port = config.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`WanderMap API listening on http://localhost:${port}/api/v1`);
  console.log(`Swagger UI available at http://localhost:${port}/docs`);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start WanderMap API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
