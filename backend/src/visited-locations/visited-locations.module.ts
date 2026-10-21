import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VisitedLocationsController } from './visited-locations.controller';
import { VisitedLocationsService } from './visited-locations.service';

@Module({ imports: [AuthModule], controllers: [VisitedLocationsController], providers: [VisitedLocationsService], exports: [VisitedLocationsService] })
export class VisitedLocationsModule {}
