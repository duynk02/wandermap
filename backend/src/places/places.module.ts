import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationsModule } from '../locations/locations.module';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

@Module({ imports: [AuthModule, LocationsModule], controllers: [PlacesController], providers: [PlacesService] })
export class PlacesModule {}