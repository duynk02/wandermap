const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const raw = process.env.WANDERMAP_TEST_DATABASE_URL;
try {
  const database = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !/(?:^|_)test(?:_|$)/i.test(database.pathname.slice(1))) throw new Error();
} catch {
  console.error('WANDERMAP_TEST_DATABASE_URL must explicitly name an isolated *_test database. Refusing skipped DB verification.');
  process.exit(1);
}
const directory = mkdtempSync(path.join(tmpdir(), 'wandermap-db-results-'));
const report = path.join(directory, 'results.json');
try {
  const run = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--config', './test/jest-db.json', '--runInBand', '--json', '--outputFile', report], { stdio: 'inherit', windowsHide: true });
  if (run.status !== 0) process.exitCode = run.status || 1;
  else {
    const result = JSON.parse(readFileSync(report, 'utf8'));
    if (result.numPendingTests || result.numPendingTestSuites || !result.numTotalTests) throw new Error('DB verification requires executed tests with no skipped suites/tests.');
    console.log(`Verified ${result.numPassedTests} database tests; none skipped.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { try { unlinkSync(report); } catch {} rmdirSync(directory); }
