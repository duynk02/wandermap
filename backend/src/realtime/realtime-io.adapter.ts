import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { IncomingMessage } from 'node:http';
import { Server, ServerOptions } from 'socket.io';

export function realtimeOrigins(config: ConfigService): string[] {
  return config.get<string>('CORS_ORIGINS', 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean);
}

/** Apply origin checks to both polling and WebSocket upgrades on the existing HTTP server. */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(app: INestApplicationContext, private readonly config: ConfigService) { super(app); }

  createIOServer(port: number, options?: ServerOptions): Server {
    const origins = realtimeOrigins(this.config);
    return super.createIOServer(port, {
      ...options,
      cors: { origin: origins, credentials: true },
      allowRequest: (request: IncomingMessage, callback: (error: string | null | undefined, allowed: boolean) => void) => {
        const origin = request.headers.origin;
        // Match the HTTP API: native/server clients may omit Origin, but still need JWT.
        callback(null, !origin || origins.includes(origin));
      },
    }) as Server;
  }
}
