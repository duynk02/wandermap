import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { AccessTokenError, AccessTokenService, VerifiedAccessToken } from '../auth/access-token.service';
import { realtimeOrigins } from './realtime-io.adapter';
import type { NotificationChangedEvent } from '../notifications/notification-events';
import type { MessagingEvent, MessagingServerEvents } from '../messaging/messaging-events';

interface LifecycleEvents extends MessagingServerEvents {
  'auth:expired': (payload: Record<string, never>) => void;
  'auth:invalidated': (payload: Record<string, never>) => void;
  'auth:unavailable': (payload: Record<string, never>) => void;
  'notification:changed': (payload: NotificationChangedEvent) => void;
  'notifications:status': (payload: { available: boolean }) => void;
}
type RealtimeSocket = Socket<Record<string, never>, LifecycleEvents, Record<string, never>, { user?: VerifiedAccessToken }>;
interface ConnectionTimers { expiry: NodeJS.Timeout; validation: NodeJS.Timeout; }

function connectionError(code: string): Error & { data: { code: string } } {
  return Object.assign(new Error('Realtime connection could not be authorized.'), { data: { code } });
}

@WebSocketGateway({
  namespace: '/realtime', path: '/socket.io', maxHttpBufferSize: 16 * 1024, connectTimeout: 10_000,
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Namespace;
  private readonly timers = new Map<string, ConnectionTimers>();
  private closing = false;
  private notificationDeliveryAvailable = false;

  constructor(private readonly accessTokens: AccessTokenService, private readonly config: ConfigService) { }

  afterInit(server: Namespace): void {
    const origins = realtimeOrigins(this.config);
    // Namespace middleware completes before connection/event dispatch, unlike handleConnection alone.
    server.use((client, next) => {
      const origin = client.handshake.headers.origin;
      if (origin && !origins.includes(origin)) return next(connectionError('ORIGIN_NOT_ALLOWED'));
      const token: unknown = client.handshake.auth?.token;
      if (typeof token !== 'string') return next(connectionError('UNAUTHORIZED'));
      void this.accessTokens.verify(token).then((user) => {
        if (this.closing || client.conn.readyState !== 'open') return next(connectionError('SERVICE_UNAVAILABLE'));
        if (user.exp * 1000 <= Date.now()) return next(connectionError('TOKEN_EXPIRED'));
        client.data.user = user;
        next();
      }).catch((error: unknown) => {
        // Never expose JWT, SQL, account details or provider exceptions to the client.
        next(connectionError(error instanceof AccessTokenError ? error.code : 'SERVICE_UNAVAILABLE'));
      });
    });
  }

  handleConnection(client: RealtimeSocket): void {
    const user = client.data.user;
    if (this.closing || !user || user.exp * 1000 <= Date.now()) { client.disconnect(true); return; }
    const expiry = setTimeout(() => this.endConnection(client, 'auth:expired'), user.exp * 1000 - Date.now());
    const validation = setTimeout(() => void this.revalidate(client), 30_000);
    expiry.unref();
    validation.unref();
    this.timers.set(client.id, { expiry, validation });
    // No client-supplied identity or room name participates in membership.
    void Promise.resolve(client.join(`user:${user.sub}`)).then(() => {
      if (client.connected) client.emit('notifications:status', { available: this.notificationDeliveryAvailable });
    }).catch(() => client.disconnect(true));
  }

  handleDisconnect(client: RealtimeSocket): void {
    const timers = this.timers.get(client.id);
    if (timers) { clearTimeout(timers.expiry); clearTimeout(timers.validation); this.timers.delete(client.id); }
    // Socket.IO removes all room membership automatically.
  }

  setNotificationDeliveryAvailable(available: boolean): void {
    this.notificationDeliveryAvailable = available;
    try { this.server?.emit('notifications:status', { available }); }
    catch { this.logger.warn('Notification transport status could not be broadcast.'); }
  }

  /** Transport only. Business persistence has already committed independently. */
  async emitNotificationChange(event: NotificationChangedEvent): Promise<void> {
    for (const client of await this.authorizedRecipientSockets(event.recipient_id)) client.emit('notification:changed', event);
  }

  /** Transport only; room identities and event fields come from server-side DB rows. */
  async emitMessagingEvent(recipient: string, event: MessagingEvent): Promise<void> {
    if (event.payload.recipient_id !== recipient) return;
    for (const client of await this.authorizedRecipientSockets(recipient)) {
      switch (event.name) {
        case 'message:new': client.emit(event.name, event.payload); break;
        case 'message:read': client.emit(event.name, event.payload); break;
        case 'conversation:updated': client.emit(event.name, event.payload); break;
      }
    }
  }

  private async authorizedRecipientSockets(recipient: string): Promise<RealtimeSocket[]> {
    if (this.closing || !this.server) return [];
    const members = this.server.adapter.rooms.get(`user:${recipient}`);
    if (!members?.size) return []; // Offline users recover durable state through REST.
    await this.accessTokens.assertActive(recipient);
    const clients: RealtimeSocket[] = [];
    for (const id of members) {
      const client = this.server.sockets.get(id) as RealtimeSocket | undefined;
      if (this.closing || !client?.connected || client.data.user?.sub !== recipient) continue;
      // Timers can run late under load. Check expiration immediately before private delivery.
      if (client.data.user.exp * 1000 <= Date.now()) { this.endConnection(client, 'auth:expired'); continue; }
      clients.push(client);
    }
    return clients;
  }

  onModuleDestroy(): void {
    this.closing = true;
    for (const timers of this.timers.values()) { clearTimeout(timers.expiry); clearTimeout(timers.validation); }
    this.timers.clear();
    this.server?.disconnectSockets(true);
  }

  private async revalidate(client: RealtimeSocket): Promise<void> {
    const user = client.data.user;
    if (!client.connected || this.closing || !user) return;
    if (user.exp * 1000 <= Date.now()) { this.endConnection(client, 'auth:expired'); return; }
    try { await this.accessTokens.assertActive(user.sub); }
    catch (error: unknown) {
      this.endConnection(client, error instanceof AccessTokenError ? 'auth:invalidated' : 'auth:unavailable'); return;
    }
    const timers = this.timers.get(client.id);
    if (!client.connected || this.closing || !timers) return;
    timers.validation = setTimeout(() => void this.revalidate(client), 30_000);
    timers.validation.unref();
  }

  private endConnection(client: RealtimeSocket, event: 'auth:expired' | 'auth:invalidated' | 'auth:unavailable'): void {
    // Clients cannot use lifecycle signals to join rooms or mutate notification state.
    client.emit(event, {});
    client.disconnect(true);
  }
}
