import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Trust only explicitly configured network peers, never arbitrary forwarded headers. */
export function applyProxyPolicy(app: NestExpressApplication, config: ConfigService): void {
  const peers = config.get<string>('TRUSTED_PROXY_CIDRS', '').split(',').map((part) => part.trim()).filter(Boolean);
  app.set('trust proxy', peers.length ? peers : false);
}
