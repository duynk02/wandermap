import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.get<number>('DB_POOL_MAX', 10),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: 'wandermap-api',
      ssl: config.get<string>('PGSSLMODE') === 'require' ? { rejectUnauthorized: true } : undefined,
    });
    this.pool.on('error', (error) => this.logger.error('Unexpected idle PostgreSQL client error', error.stack));
  }

  async onModuleInit() {
    await this.pool.query('SELECT 1');
    this.logger.log('PostgreSQL connection established');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  query<T = any>(text: string, values: unknown[] = []): Promise<QueryResult<T & QueryResultRow>> {
    return this.pool.query<T & QueryResultRow>(text, values as any[]);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async check(): Promise<{ connected: boolean; latencyMs: number }> {
    const start = performance.now();
    await this.pool.query('SELECT 1');
    return { connected: true, latencyMs: Math.round(performance.now() - start) };
  }
}
