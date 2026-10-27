import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { MediaController } from './media.controller';
import { STORAGE_PROVIDER } from './storage/storage-provider';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { CloudinaryStorageProvider } from './storage/cloudinary-storage.provider';
import { MediaHeadersMiddleware } from './media-headers.middleware';

@Module({ imports: [AuthModule], controllers: [UploadsController, MediaController], providers: [UploadsService, StorageService,
  { provide: STORAGE_PROVIDER, inject: [ConfigService], useFactory: (config: ConfigService) =>
    config.get<string>('STORAGE_PROVIDER', 'local') === 'cloudinary' ? new CloudinaryStorageProvider(config) : new LocalStorageProvider(config) },
], exports: [UploadsService, StorageService] })
export class UploadsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(MediaHeadersMiddleware).forRoutes(MediaController); }
}
