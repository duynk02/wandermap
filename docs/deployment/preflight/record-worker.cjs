// Build evidence only. Does not import the migration runner or connect to a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { root, releaseSha, verifyArtifact } = require('./verify-artifact.cjs');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifactHash = (file) => sha256(fs.readFileSync(file));
const relativeHashes = (directory) => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? relativeHashes(file) : [{ path: path.relative(root, file).split(path.sep).join('/'), sha256: artifactHash(file) }];
});
assert.equal(process.version, 'v22.23.4');
assert.equal(process.env.DATABASE_URL, undefined);
assert.equal(process.env.WANDERMAP_TEST_DATABASE_URL, undefined);
const migrations = verifyArtifact();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '');
for (const app of ['backend', 'frontend']) assert.equal(fs.existsSync(path.join(root, app, '.env')), false);
const compiled = relativeHashes(path.join(root, 'backend/dist'));
const helpers = ['verify-artifact.cjs', 'inspect-production.cjs', 'runtime-inspect.sh', 'record-worker.cjs']
  .map((name) => ({ name, sha256: artifactHash(path.join(__dirname, name)) }));
const evidence = {
  result: 'PASS', applicationRelease: releaseSha, releaseTree: git('rev-parse', 'HEAD^{tree}'),
  node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), platform: process.platform, arch: process.arch,
  baseImage: 'node@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384',
  checkoutClean: true, credentialsPresent: false, migrations, helpers,
  manifestSha256: artifactHash(path.join(root, 'backend/scripts/historical-migrations.json')),
  lockfileSha256: artifactHash(path.join(root, 'backend/package-lock.json')),
  compiledFileCount: compiled.length, compiledInventorySha256: sha256(JSON.stringify(compiled)),
  productionDatabaseInspected: false, productionBackupExecuted: false, migrationRunnerExecuted: false,
};
fs.mkdirSync('/artifacts', { recursive: true });
fs.writeFileSync('/artifacts/compiled-files.json', JSON.stringify(compiled, null, 2) + '\n');
fs.writeFileSync('/artifacts/worker-verification.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
