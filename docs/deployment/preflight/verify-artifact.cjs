// Offline only: never imports the migration runner or opens a database connection.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.env.WANDERMAP_RELEASE_ROOT || path.join(__dirname, '../../..'));
const releaseSha = '818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a';
const baseline = '5c5bbf0';
const releaseTree = '3a8e0e2c461a9a79449c900ed9c921ab4048fe1f';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true });
const read = (name) => fs.readFileSync(path.join(root, name));
const sourceDir = 'backend/src/database/migrations';
const artifactDir = 'backend/dist/database/migrations';
const list = (dir) => fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.sql')).sort();

function verifyArtifact() {
  // Operational helpers may live outside the checkout. The application release is fixed.
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), releaseSha, 'Worker HEAD must be the approved release.');
  assert.equal(git('rev-parse', '818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a^{tree}').toString().trim(), releaseTree);
  assert.equal(git('diff', '--name-only', '818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a', '--',
    'backend', '.node-version', '.gitattributes', '.github').toString().trim(), '', 'Release source/config drift.');
  const manifestPath = 'backend/scripts/historical-migrations.json';
  const manifest = JSON.parse(read(manifestPath));
  assert.equal(hash(read(manifestPath).toString().replace(/\r\n/g, '\n')),
    hash(git('show', `818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a:${manifestPath}`)));
  assert.equal(Object.keys(manifest).length, 14);
  const files = list(sourceDir);
  assert.equal(files.length, 16);
  assert.deepEqual(list(artifactDir), files);
  const rows = files.map((name, index) => {
    assert.equal(name.slice(0, 4), `${String(index + 1).padStart(3, '0')}_`);
    const source = read(`${sourceDir}/${name}`);
    const artifact = read(`${artifactDir}/${name}`);
    const release = git('show', `818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a:${sourceDir}/${name}`);
    assert.equal(hash(artifact), hash(release), `Artifact drift: ${name}`);
    assert.equal(artifact.includes(13), false, `Artifact must be LF: ${name}`);
    if (index < 14) {
      assert.ok(manifest[name], `Missing historical entry: ${name}`);
      assert.equal(hash(git('show', `${baseline}:${sourceDir}/${name}`)), hash(release));
      assert.equal(manifest[name].canonical, hash(release));
      assert.equal(manifest[name].windows, hash(Buffer.from(release.toString().replace(/\n/g, '\r\n'))));
      assert.ok([manifest[name].canonical, manifest[name].windows].includes(hash(source)), `Source drift: ${name}`);
    } else {
      assert.equal(hash(source), hash(release), `Source drift: ${name}`);
    }
    return { name, checksum: hash(artifact) };
  });
  for (const file of ['migrate.js', 'connection-options.js', 'migration-artifact.js']) {
    assert.ok(fs.statSync(path.join(root, 'backend/dist/database', file)).size > 0);
  }
  const pkg = JSON.parse(read('backend/package.json'));
  assert.equal(pkg.scripts['db:migrate:prod'], 'node dist/database/migrate.js');
  return rows;
}

module.exports = { root, releaseSha, verifyArtifact };
if (require.main === module) {
  try {
    const rows = verifyArtifact();
    console.log(JSON.stringify({ result: 'PASS', migrations: rows }, null, 2));
  } catch {
    console.error('FAIL: release migration artifact/baseline mismatch or missing release Git object.');
    process.exitCode = 1;
  }
}
