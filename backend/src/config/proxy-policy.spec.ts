import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import request from 'supertest';
import { applyProxyPolicy } from './proxy-policy';

@Module({})
class ProxyTestModule {}

describe('HTTP proxy trust boundary', () => {
  let app: NestExpressApplication;
  afterEach(async () => { await app?.close(); });
  async function setup(peers: string) {
    const module = await Test.createTestingModule({ imports: [ProxyTestModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    applyProxyPolicy(app, new ConfigService({ TRUSTED_PROXY_CIDRS: peers }));
    app.getHttpAdapter().getInstance().get('/ip', (req: Request, res: Response) => res.json({ ip: req.ip, ips: req.ips }));
    await app.init();
    return request(app.getHttpServer());
  }
  it('ignores forwarded IPs when the immediate network peer is untrusted', async () => {
    const response = await (await setup('10.0.0.0/24')).get('/ip').set('X-Forwarded-For', '198.51.100.2');
    expect(response.body.ips).toEqual([]);
    expect(response.body.ip).not.toBe('198.51.100.2');
  });
  it('stops at the first untrusted forwarded hop instead of accepting a forged leftmost address', async () => {
    const response = await (await setup('127.0.0.1/32,::1/128')).get('/ip').set('X-Forwarded-For', '198.51.100.2,203.0.113.9');
    expect(response.body.ip).toBe('203.0.113.9');
    expect(response.body.ips).toEqual(['203.0.113.9']);
  });
});
