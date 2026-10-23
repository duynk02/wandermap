import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NOTIFICATION_CHANNEL, NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

class FakeClient extends EventEmitter {
  connect = jest.fn().mockResolvedValue(undefined);
  query = jest.fn().mockResolvedValue({ rows: [] });
  end = jest.fn().mockImplementation(async () => { this.emit('end'); });
}

function setup() {
  const clients: FakeClient[] = [];
  const createClient = jest.fn(() => {
    const client = new FakeClient();
    clients.push(client);
    return client as unknown as Client;
  });
  const publishDatabaseChange = jest.fn().mockResolvedValue(undefined);
  const setNotificationDeliveryAvailable = jest.fn();
  const listener = new NotificationsListener(createClient,
    { publishDatabaseChange } as unknown as NotificationsService,
    { setNotificationDeliveryAvailable } as unknown as RealtimeGateway);
  return { listener, clients, createClient, publishDatabaseChange, setNotificationDeliveryAvailable };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('NotificationsListener dedicated PostgreSQL connection lifecycle', () => {
  const harnesses: ReturnType<typeof setup>[] = [];
  const harness = () => { const value = setup(); harnesses.push(value); return value; };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    for (const { listener } of harnesses.splice(0)) await listener.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('announces availability only after both connect and LISTEN have completed', async () => {
    const { listener, clients, createClient, setNotificationDeliveryAvailable } = harness();
    const pendingClient = new FakeClient();
    let connected!: () => void;
    let listening!: (value: { rows: unknown[] }) => void;
    pendingClient.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { connected = resolve; }));
    pendingClient.query.mockImplementationOnce(() => new Promise((resolve) => { listening = resolve; }));
    createClient.mockImplementationOnce(() => { clients.push(pendingClient); return pendingClient as unknown as Client; });
    const initial = listener.onModuleInit();
    expect(setNotificationDeliveryAvailable).not.toHaveBeenCalled();
    connected();
    await flush();
    expect(pendingClient.query).toHaveBeenCalledWith(`LISTEN ${NOTIFICATION_CHANNEL}`);
    expect(setNotificationDeliveryAvailable).not.toHaveBeenCalledWith(true);
    listening({ rows: [] });
    await initial;
    expect(setNotificationDeliveryAvailable).toHaveBeenLastCalledWith(true);
  });

  it('delegates committed channel messages, ignores other channels/empty messages, and isolates rejected delivery', async () => {
    const { listener, clients, publishDatabaseChange } = harness();
    await listener.onModuleInit();
    const client = clients[0];
    client.emit('notification', { channel: 'other', payload: 'not ours' });
    client.emit('notification', { channel: NOTIFICATION_CHANNEL });
    client.emit('notification', { channel: NOTIFICATION_CHANNEL, payload: '' });
    expect(publishDatabaseChange).not.toHaveBeenCalled();
    client.emit('notification', { channel: NOTIFICATION_CHANNEL, payload: 'malformed-is-validated-by-the-service' });
    expect(publishDatabaseChange).toHaveBeenCalledWith('malformed-is-validated-by-the-service');
    publishDatabaseChange.mockRejectedValueOnce(new Error('Transport unavailable after commit.'));
    expect(() => client.emit('notification', { channel: NOTIFICATION_CHANNEL, payload: 'committed' })).not.toThrow();
    await flush();
    expect(Logger.prototype.warn).toHaveBeenCalledWith('A committed notification could not be delivered; REST remains authoritative.');
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(`LISTEN ${NOTIFICATION_CHANNEL}`);
    expect(client.end).not.toHaveBeenCalled();
  });

  it.each(['error', 'end'])('marks delivery unavailable and reconnects once after a client %s', async (failure) => {
    const { listener, clients, createClient, setNotificationDeliveryAvailable } = harness();
    await listener.onModuleInit();
    const old = clients[0];
    old.emit(failure, new Error('Connection unavailable.'));
    expect(setNotificationDeliveryAvailable).toHaveBeenLastCalledWith(false);
    expect(old.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    old.emit('error', new Error('An old client error must not schedule another retry.'));
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(999);
    expect(createClient).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(clients[1].query).toHaveBeenCalledWith(`LISTEN ${NOTIFICATION_CHANNEL}`);
    expect(setNotificationDeliveryAvailable).toHaveBeenLastCalledWith(true);
  });

  it('ignores notifications and failures from a replaced client while the new listener remains usable', async () => {
    const { listener, clients, publishDatabaseChange, setNotificationDeliveryAvailable } = harness();
    await listener.onModuleInit();
    const old = clients[0];
    old.emit('error', new Error('Connection lost.'));
    await jest.advanceTimersByTimeAsync(1000);
    old.emit('notification', { channel: NOTIFICATION_CHANNEL, payload: 'stale' });
    old.emit('end');
    old.emit('error', new Error('Old error.'));
    expect(publishDatabaseChange).not.toHaveBeenCalled();
    expect(setNotificationDeliveryAvailable).toHaveBeenLastCalledWith(true);
    clients[1].emit('notification', { channel: NOTIFICATION_CHANNEL, payload: 'current' });
    expect(publishDatabaseChange).toHaveBeenCalledWith('current');
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['connect', 'query'])('handles rejected %s without failing module initialization and retries later', async (stage) => {
    const { listener, createClient, clients, setNotificationDeliveryAvailable } = harness();
    const failed = new FakeClient();
    if (stage === 'connect') failed.connect.mockRejectedValueOnce(new Error('Database not available.'));
    else failed.query.mockRejectedValueOnce(new Error('Database not available.'));
    createClient.mockImplementationOnce(() => { clients.push(failed); return failed as unknown as Client; });
    await expect(listener.onModuleInit()).resolves.toBeUndefined();
    expect(setNotificationDeliveryAvailable).toHaveBeenLastCalledWith(false);
    expect(failed.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(setNotificationDeliveryAvailable).toHaveBeenLastCalledWith(true);
  });

  it('handles client factory failure and caps reconnect backoff at thirty seconds', async () => {
    const { listener, createClient } = harness();
    createClient.mockImplementation(() => { throw new Error('Factory unavailable.'); });
    await listener.onModuleInit();
    expect(createClient).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(createClient).toHaveBeenCalledTimes(index + 1);
      await jest.advanceTimersByTimeAsync(1);
      expect(createClient).toHaveBeenCalledTimes(index + 2);
      expect(jest.getTimerCount()).toBe(1);
    }
  });

  it('cancels a scheduled retry on shutdown and does not reconnect after late client events', async () => {
    const { listener, clients, createClient, publishDatabaseChange, setNotificationDeliveryAvailable } = harness();
    await listener.onModuleInit();
    const old = clients[0];
    old.emit('error', new Error('Connection lost.'));
    await listener.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    old.emit('notification', { channel: NOTIFICATION_CHANNEL, payload: 'too late' });
    old.emit('end');
    await jest.advanceTimersByTimeAsync(30000);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(publishDatabaseChange).not.toHaveBeenCalled();
    expect(setNotificationDeliveryAvailable).toHaveBeenLastCalledWith(false);
  });

  it('cannot become available after shutdown while LISTEN was pending', async () => {
    const { listener, createClient, clients, setNotificationDeliveryAvailable } = harness();
    const client = new FakeClient();
    let listening!: (value: { rows: unknown[] }) => void;
    client.query.mockImplementationOnce(() => new Promise((resolve) => { listening = resolve; }));
    createClient.mockImplementationOnce(() => { clients.push(client); return client as unknown as Client; });
    const initial = listener.onModuleInit();
    await flush();
    await listener.onModuleDestroy();
    listening({ rows: [] });
    await initial;
    expect(setNotificationDeliveryAvailable).not.toHaveBeenCalledWith(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
