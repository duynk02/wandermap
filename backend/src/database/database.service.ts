import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientConfig, Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { databaseConnectionOptions } from './connection-options';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly connectionConfig: ClientConfig;

  constructor(config: ConfigService) {
    this.connectionConfig = {
      ...databaseConnectionOptions(config.getOrThrow<string>('DATABASE_URL'), config.get<string>('PGSSLMODE', ''), config.get<string>('NODE_ENV') === 'production'),
      connectionTimeoutMillis: 5_000,
      application_name: 'wandermap-api',
    };
    this.pool = new Pool({
      ...this.connectionConfig,
      max: config.get<number>('DB_POOL_MAX', 10),
      idleTimeoutMillis: 30_000,
    });
    this.pool.on('error', () => this.logger.error('Unexpected idle PostgreSQL client error; verify database availability.'));
  }

  async onModuleInit() {
    await this.pool.query('SELECT 1');
    this.logger.log('PostgreSQL connection established');
  }

  /** One long-lived listener, separate from the request pool (including DB_POOL_MAX=1). */
  createListener(): Client { return new Client({ ...this.connectionConfig, application_name: 'wandermap-notifications' }); }

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
