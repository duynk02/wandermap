const { readdir, readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { migrationArtifact } = require('../dist/database/migration-artifact.js');
const historical = require('./historical-migrations.json');

async function main() {
  const source = path.resolve(__dirname, '../src/database/migrations');
  const target = path.resolve(__dirname, '../dist/database/migrations');
  await mkdir(target, { recursive: true });
  const files = (await readdir(source)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  for (const name of Object.keys(historical)) if (!files.includes(name)) throw new Error(`Missing historical migration ${name}.`);
  for (const name of files) await writeFile(path.join(target, name), migrationArtifact(await readFile(path.join(source, name)), historical[name]));
  console.log(`Packaged ${files.length} verified SQL migrations; source files unchanged.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
