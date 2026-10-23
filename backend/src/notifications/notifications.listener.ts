import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client, Notification } from 'pg';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export const NOTIFICATION_LISTENER_CLIENT = Symbol('NOTIFICATION_LISTENER_CLIENT');
export const NOTIFICATION_CHANNEL = 'wandermap_notifications';

/** A dedicated session is required: LISTEN state belongs to a connection, not a pool. */
@Injectable()
export class NotificationsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsListener.name);
  private client?: Client;
  private retryTimer?: NodeJS.Timeout;
  private stopped = false;
  private retryDelay = 1_000;

  constructor(
    @Inject(NOTIFICATION_LISTENER_CLIENT) private readonly createClient: () => Client,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> { await this.connect(); }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let client: Client;
    try { client = this.createClient(); }
    catch { this.scheduleRetry(); return; }
    this.client = client;
    const unavailable = () => {
      if (this.client !== client) return;
      this.client = undefined;
      this.realtime.setNotificationDeliveryAvailable(false);
      void client.end().catch(() => undefined);
      this.scheduleRetry();
    };
    client.on('error', unavailable);
    client.on('end', unavailable);
    client.on('notification', (message: Notification) => {
      if (this.stopped || this.client !== client || message.channel !== NOTIFICATION_CHANNEL || !message.payload) return;
      // NOTIFY is received only after commit. Neither enrichment nor transport failures
      // can propagate back to the already completed business transaction.
      void this.notifications.publishDatabaseChange(message.payload).catch(() => {
        this.logger.warn('A committed notification could not be delivered; REST remains authoritative.');
      });
    });
    try {
      await client.connect();
      if (this.stopped || this.client !== client) { await client.end().catch(() => undefined); return; }
      await client.query(`LISTEN ${NOTIFICATION_CHANNEL}`);
      if (this.stopped || this.client !== client) return;
      this.retryDelay = 1_000;
      this.realtime.setNotificationDeliveryAvailable(true);
    } catch { unavailable(); }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.logger.warn('Notification listener unavailable; retrying with bounded backoff.');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, this.retryDelay);
    this.retryTimer.unref();
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const client = this.client;
    this.client = undefined;
    this.realtime.setNotificationDeliveryAvailable(false);
    await client?.end().catch(() => undefined);
  }
}
