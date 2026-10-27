const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:net');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

async function main() {
  const raw = process.env.WANDERMAP_TEST_DATABASE_URL;
  try { if (!/(?:^|_)test(?:_|$)/i.test(new URL(raw).pathname.slice(1))) throw new Error(); }
  catch { throw new Error('Explicit isolated WANDERMAP_TEST_DATABASE_URL required; never falls back to application DATABASE_URL.'); }
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const directory = await mkdtemp(path.join(tmpdir(), 'wandermap-startup-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/main.js'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_URL: raw, PGSSLMODE: '',
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'), CORS_ORIGINS: 'http://localhost:3000',
    COOKIE_SECURE: 'false', COOKIE_SAME_SITE: 'lax', STORAGE_PROVIDER: 'local',
    PUBLIC_API_URL: `${origin}/api/v1`, UPLOAD_DIR: directory, SERVE_LEGACY_UPLOADS: 'false',
  } });
  // Never print process output containing account/cookie/provider details.
  child.stdout.resume(); child.stderr.resume();
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  let socket;
  let stopped = false;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error('Compiled API exited during startup.');
      try { const response = await fetch(`${origin}/api/v1/health`); ready = response.ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Compiled API did not become DB-ready.');
    const suffix = randomBytes(6).toString('hex');
    const registration = await fetch(`${origin}/api/v1/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: `${suffix}@example.test`, username: `smoke_${suffix}`, display_name: 'Startup test', password: randomBytes(18).toString('hex') }) });
    assert.equal(registration.status, 201);
    const { accessToken } = await registration.json();
    socket = io(`${origin}/realtime`, { transports: ['websocket'], auth: { token: accessToken }, extraHeaders: { Origin: 'http://localhost:3000' }, reconnection: false });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Compiled realtime handshake timed out.')), 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', () => { clearTimeout(timer); reject(new Error('Compiled realtime handshake failed.')); });
    });
    child.kill('SIGTERM');
    const termination = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('API shutdown timed out.')), 10_000))]);
    stopped = true;
    assert.ok(termination.code === 0 || termination.signal === 'SIGTERM', 'API did not terminate cleanly.');
    console.log('Compiled API, real PostgreSQL health, authenticated /realtime and SIGTERM shutdown: PASS (local provider only).');
  } finally {
    socket?.disconnect();
    if (!stopped) { child.kill('SIGTERM'); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]); }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (directory.startsWith(path.join(tmpdir(), 'wandermap-startup-'))) await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
