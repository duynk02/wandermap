import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and PostgreSQL health' })
  async check() {
    try {
      const database = await this.db.check();
      return { status: 'ok', timestamp: new Date().toISOString(), dependencies: { database: { status: 'ok', ...database } } };
    } catch {
      throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE', message: 'The database is currently unavailable.' });
    }
  }
}
