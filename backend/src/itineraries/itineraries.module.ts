import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';

@Module({ imports: [AuthModule], controllers: [ItinerariesController], providers: [ItinerariesService] })
export class ItinerariesModule {}
