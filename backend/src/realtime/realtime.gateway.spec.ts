import { Global, INestApplication, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Socket as ServerSocket } from 'socket.io';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeIoAdapter } from './realtime-io.adapter';
import { RealtimeModule } from './realtime.module';

const SECRET = 'realtime-integration-test-secret-at-least-32-characters';
const ORIGIN = 'http://localhost:3000';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const query = jest.fn();

@Global()
@Module({
  providers: [{ provide: DatabaseService, useValue: { query } }],
  exports: [DatabaseService],
})
class TestDatabaseModule {}

type ConnectionError = Error & { data?: { code?: string } };

describe('Realtime gateway authentication and room isolation (integration)', () => {
  let app: INestApplication;
  let gateway: RealtimeGateway;
  let jwt: JwtService;
  let url: string;
  const clients = new Set<ClientSocket>();

  beforeAll(async () => {
    query.mockResolvedValue({ rows: [{ is_active: true }], rowCount: 1 });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => ({ JWT_ACCESS_SECRET: SECRET, CORS_ORIGINS: ORIGIN })],
        }),
        TestDatabaseModule,
        RealtimeModule,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new RealtimeIoAdapter(app, app.get(ConfigService)));
    await app.listen(0, '127.0.0.1');
    gateway = app.get(RealtimeGateway);
    jwt = app.get(JwtService);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/realtime`;
  });

  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ is_active: true }], rowCount: 1 });
  });

  afterEach(async () => {
    const disconnected = [...gateway.server.sockets.values()].map((socket) =>
      new Promise<void>((resolve) => socket.once('disconnect', () => resolve())),
    );
    for (const socket of clients) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    clients.clear();
    await Promise.all(disconnected);
  });

  afterAll(async () => {
    await app?.close();
  });

  function client(auth?: Record<string, unknown>, options: { origin?: string; transport?: 'websocket' | 'polling'; query?: Record<string, string> } = {}): ClientSocket {
    const socket = io(url, {
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      timeout: 2_000,
      transports: [options.transport ?? 'websocket'],
      extraHeaders: { Origin: options.origin ?? ORIGIN },
      auth,
      query: options.query,
    });
    clients.add(socket);
    return socket;
  }

  async function token(userId = USER_A): Promise<string> {
    return jwt.signAsync({ sub: userId, email: `${userId}@example.test` }, { expiresIn: 60 });
  }

  function connect(socket: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('connect', connected);
        socket.off('connect_error', failed);
      };
      const connected = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const timeout = setTimeout(() => failed(new Error('Socket handshake did not finish.')), 3_000);
      socket.once('connect', connected);
      socket.once('connect_error', failed);
      socket.connect();
    });
  }

  async function rejected(socket: ClientSocket): Promise<ConnectionError> {
    try {
      await connect(socket);
    } catch (error) {
      return error as ConnectionError;
    }
    throw new Error('An unauthorized connection was accepted.');
  }

  function event<T = unknown>(socket: ClientSocket, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const listener = (payload: T) => { clearTimeout(timeout); resolve(payload); };
      const timeout = setTimeout(() => {
        socket.off(name, listener);
        reject(new Error(`Expected socket event: ${name}`));
      }, 3_000);
      socket.once(name, listener);
    });
  }

  it('verifies JWT and joins a private room derived only from the verified identity', async () => {
    const socket = client({ token: await token(), userId: USER_B, room: `user:${USER_B}` });
    await connect(socket);
    const serverSocket = gateway.server.sockets.get(socket.id!);
    expect(serverSocket?.data.user).toMatchObject({ sub: USER_A, email: `${USER_A}@example.test` });
    expect(serverSocket?.rooms.has(`user:${USER_A}`)).toBe(true);
    expect(serverSocket?.rooms.has(`user:${USER_B}`)).toBe(false);
  });

  it('rejects connections without a JWT in the auth payload, including query-string credentials', async () => {
    for (const socket of [client(), client(undefined, { query: { token: await token() } })]) {
      expect((await rejected(socket)).data?.code).toBe('UNAUTHORIZED');
    }
    expect(gateway.server.sockets.size).toBe(0);
  });

  it('rejects JWTs with an invalid signature', async () => {
    const forged = await new JwtService({ secret: 'another-test-secret-not-trusted-by-the-gateway' })
      .signAsync({ sub: USER_A, email: 'a@example.test' }, { expiresIn: 60 });
    expect((await rejected(client({ token: forged }))).data?.code).toBe('UNAUTHORIZED');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects expired JWTs with a specific refreshable error', async () => {
    const expired = await jwt.signAsync({ sub: USER_A, email: 'a@example.test', exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await rejected(client({ token: expired }))).data?.code).toBe('TOKEN_EXPIRED');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects tokens without required identity or expiry claims', async () => {
    const invalidClaims = [
      { email: 'a@example.test', exp: Math.floor(Date.now() / 1000) + 60 },
      { sub: USER_A, exp: Math.floor(Date.now() / 1000) + 60 },
      { sub: USER_A, email: 'a@example.test' },
    ];
    for (const claims of invalidClaims) {
      expect((await rejected(client({ token: await jwt.signAsync(claims) }))).data?.code).toBe('UNAUTHORIZED');
    }
  });

  it('rejects disabled or missing users and does not create their private room', async () => {
    for (const rows of [[{ is_active: false }], []]) {
      query.mockResolvedValueOnce({ rows, rowCount: rows.length });
      expect((await rejected(client({ token: await token() }))).data?.code).toBe('UNAUTHORIZED');
    }
    expect(gateway.server.adapter.rooms.has(`user:${USER_A}`)).toBe(false);
  });

  it('fails closed on database errors without exposing internal details', async () => {
    query.mockRejectedValueOnce(new Error('private-database-details must not be exposed'));
    const error = await rejected(client({ token: await token() }));
    expect(error.data?.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify({ message: error.message, data: error.data })).not.toContain('private-database-details');
    expect(gateway.server.sockets.size).toBe(0);
  });

  it('finishes asynchronous authentication before exposing the socket or joining private rooms', async () => {
    let finishAuthentication!: (value: { rows: { is_active: boolean }[]; rowCount: number }) => void;
    let verificationStarted!: () => void;
    const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
    query.mockImplementationOnce(() => {
      verificationStarted();
      return new Promise((resolve) => { finishAuthentication = resolve; });
    });
    const socket = client({ token: await token() });
    const connected = connect(socket);
    await started;
    socket.emit('join', { room: `user:${USER_B}`, userId: USER_B });
    expect(gateway.server.sockets.size).toBe(0);
    expect(gateway.server.adapter.rooms.has(`user:${USER_A}`)).toBe(false);
    expect(gateway.server.adapter.rooms.has(`user:${USER_B}`)).toBe(false);
    finishAuthentication({ rows: [{ is_active: true }], rowCount: 1 });
    await connected;
    expect(gateway.server.sockets.get(socket.id!)?.rooms.has(`user:${USER_A}`)).toBe(true);
    expect(gateway.server.sockets.get(socket.id!)?.rooms.has(`user:${USER_B}`)).toBe(false);
  });

  it('delivers private events to every connection of the recipient and isolates other users', async () => {
    const [a1, a2, b] = [client({ token: await token() }), client({ token: await token() }), client({ token: await token(USER_B) })];
    await Promise.all([connect(a1), connect(a2), connect(b)]);
    const bMessages: unknown[] = [];
    b.on('test:private', (payload: unknown) => bMessages.push(payload));
    const receivedA1 = event(a1, 'test:private');
    const receivedA2 = event(a2, 'test:private');
    // This server-only emission exercises the transport; notification creation is outside Step 1.
    const barrier = event(b, 'test:barrier');
    gateway.server.to(`user:${USER_A}`).emit('test:private', { recipient: USER_A });
    gateway.server.emit('test:barrier');
    await Promise.all([receivedA1, receivedA2, barrier]);
    expect(bMessages).toEqual([]);
    expect(gateway.server.adapter.rooms.get(`user:${USER_A}`)?.size).toBe(2);
  });

  it('does not accept client requests to join another user room', async () => {
    const socket = client({ token: await token() });
    await connect(socket);
    socket.emit('join', { room: `user:${USER_B}` });
    socket.emit('join-room', `user:${USER_B}`);
    socket.emit('user:join', USER_B);
    // A test-only round trip acknowledges all earlier packets on this connection.
    const serverSocket = gateway.server.sockets.get(socket.id!)!;
    serverSocket.once('test:barrier', () => serverSocket.emit('test:barrier'));
    const barrier = event(socket, 'test:barrier');
    socket.emit('test:barrier');
    await barrier;
    expect(gateway.server.sockets.get(socket.id!)?.rooms.has(`user:${USER_B}`)).toBe(false);
  });

  it.each(['websocket', 'polling'] as const)('enforces the allowed Origin for %s transport', async (transport) => {
    const socket = client({ token: await token() }, { origin: 'https://untrusted.example.test', transport });
    await rejected(socket);
    expect(socket.connected).toBe(false);
    expect(gateway.server.adapter.rooms.has(`user:${USER_A}`)).toBe(false);
  });

  it('accepts the configured Origin for polling transport as well as websocket', async () => {
    const socket = client({ token: await token() }, { transport: 'polling' });
    await connect(socket);
    expect(socket.connected).toBe(true);
  });

  it('notifies and disconnects a live socket when its access JWT expires', async () => {
    const expires = Math.floor(Date.now() / 1000) + 2;
    const shortToken = await jwt.signAsync({ sub: USER_A, email: 'a@example.test', exp: expires });
    const socket = client({ token: shortToken });
    await connect(socket);
    const expired = event(socket, 'auth:expired');
    const disconnected = event<string>(socket, 'disconnect');
    expect(await expired).toEqual({});
    expect(await disconnected).toBe('io server disconnect');
    expect(socket.connected).toBe(false);
    expect(gateway.server.adapter.rooms.has(`user:${USER_A}`)).toBe(false);
  });

  it.each(['disabled account', 'database outage'])('invalidates an existing connection after revalidation detects %s', async (condition) => {
    const socket = client({ token: await token() });
    await connect(socket);
    const serverSocket = gateway.server.sockets.get(socket.id!)!;
    const invalidated = event(socket, condition === 'disabled account' ? 'auth:invalidated' : 'auth:unavailable');
    const disconnected = event(socket, 'disconnect');
    if (condition === 'disabled account') query.mockResolvedValueOnce({ rows: [{ is_active: false }], rowCount: 1 });
    else query.mockRejectedValueOnce(new Error('Database unavailable.'));
    // Exercise scheduled validation immediately without changing Socket.IO's heartbeat clock.
    await (gateway as unknown as { revalidate(client: ServerSocket): Promise<void> }).revalidate(serverSocket);
    expect(await invalidated).toEqual({});
    await disconnected;
    expect(gateway.server.adapter.rooms.has(`user:${USER_A}`)).toBe(false);
  });

  it('removes only the disconnected connection from rooms while keeping other tabs connected', async () => {
    const [a1, a2] = [client({ token: await token() }), client({ token: await token() })];
    await Promise.all([connect(a1), connect(a2)]);
    const serverSocket = gateway.server.sockets.get(a1.id!)!;
    const disconnected = new Promise<void>((resolve) => serverSocket.once('disconnect', () => resolve()));
    a1.disconnect();
    await disconnected;
    expect(gateway.server.adapter.rooms.get(`user:${USER_A}`)?.size).toBe(1);
    expect(a2.connected).toBe(true);
  });

  it('sends a typed notification invalidation to every recipient tab and no other user', async () => {
    const [a1, a2, b] = [client({ token: await token() }), client({ token: await token() }), client({ token: await token(USER_B) })];
    await Promise.all([connect(a1), connect(a2), connect(b)]);
    const change = { notification_id: USER_B, recipient_id: USER_A, type: 'like' as const, change: 'created' as const };
    const others: unknown[] = [];
    b.on('notification:changed', (payload: unknown) => others.push(payload));
    const first = event(a1, 'notification:changed');
    const second = event(a2, 'notification:changed');
    const barrier = event(b, 'test:barrier');
    await gateway.emitNotificationChange(change);
    gateway.server.emit('test:barrier');
    expect(await first).toEqual(change);
    expect(await second).toEqual(change);
    await barrier;
    expect(others).toEqual([]);
    expect(query).toHaveBeenLastCalledWith('SELECT is_active FROM users WHERE id = $1', [USER_A]);
  });

  it('does not perform private delivery when the recipient is inactive', async () => {
    const socket = client({ token: await token() });
    await connect(socket);
    const received: unknown[] = [];
    socket.on('notification:changed', (payload: unknown) => received.push(payload));
    query.mockResolvedValueOnce({ rows: [{ is_active: false }], rowCount: 1 });
    await expect(gateway.emitNotificationChange({ notification_id: USER_B, recipient_id: USER_A, type: 'comment', change: 'created' })).rejects.toThrow();
    const barrier = event(socket, 'test:barrier');
    gateway.server.emit('test:barrier');
    await barrier;
    expect(received).toEqual([]);
  });

  it('rechecks JWT expiry at delivery time even if the expiry timer has not fired', async () => {
    const socket = client({ token: await token() });
    await connect(socket);
    const serverSocket = gateway.server.sockets.get(socket.id!)!;
    serverSocket.data.user.exp = Math.floor(Date.now() / 1000) - 1;
    const received: unknown[] = [];
    socket.on('notification:changed', (payload: unknown) => received.push(payload));
    const expired = event(socket, 'auth:expired');
    const disconnected = event(socket, 'disconnect');
    await gateway.emitNotificationChange({ notification_id: USER_B, recipient_id: USER_A, type: 'like', change: 'created' });
    await expired;
    await disconnected;
    expect(received).toEqual([]);
    expect(gateway.server.adapter.rooms.has(`user:${USER_A}`)).toBe(false);
  });

  it('keeps offline notifications in persistent storage without opening user queries for delivery', async () => {
    await gateway.emitNotificationChange({ notification_id: USER_B, recipient_id: USER_A, type: 'follow', change: 'created' });
    expect(query).not.toHaveBeenCalled();
  });

  it('isolates transport status broadcast failures from listener lifecycle', () => {
    const broadcast = jest.spyOn(gateway.server, 'emit').mockImplementationOnce(() => { throw new Error('Transport unavailable'); });
    try {
      expect(() => gateway.setNotificationDeliveryAvailable(true)).not.toThrow();
      expect(broadcast).toHaveBeenCalledWith('notifications:status', { available: true });
    } finally { broadcast.mockRestore(); }
  });

  it('disconnects every user and clears private rooms when the gateway shuts down', async () => {
    const [a, b] = [client({ token: await token() }), client({ token: await token(USER_B) })];
    await Promise.all([connect(a), connect(b)]);
    const disconnected = [event(a, 'disconnect'), event(b, 'disconnect')];
    gateway.onModuleDestroy();
    await Promise.all(disconnected);
    expect(gateway.server.sockets.size).toBe(0);
    expect(gateway.server.adapter.rooms.has(`user:${USER_A}`)).toBe(false);
    expect(gateway.server.adapter.rooms.has(`user:${USER_B}`)).toBe(false);
    expect((await rejected(client({ token: await token() }))).data?.code).toBe('SERVICE_UNAVAILABLE');
  });
});
