// Build the current source without overwriting .next used by an existing dev server.
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  rmdir,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("..", import.meta.url));
// Keep the snapshot on the same Windows drive as Next's installed packages.
const snapshotParent = path.resolve(frontend, "build");
await mkdir(snapshotParent, { recursive: true });
const snapshot = await mkdtemp(path.join(snapshotParent, "profile-build-"));
const links = [];
try {
  const entries = await readdir(frontend, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "src" ||
      entry.name === "public" ||
      (entry.isFile() && /\.(json|ts|mjs)$/.test(entry.name)) ||
      /^\.env(?:\.|$)/.test(entry.name)
    ) {
      await cp(
        path.join(frontend, entry.name),
        path.join(snapshot, entry.name),
        { recursive: true },
      );
    }
  }
  const modules = path.join(snapshot, "node_modules");
  await mkdir(modules);
  for (const entry of await readdir(path.join(frontend, "node_modules"), {
    withFileTypes: true,
  })) {
    const source = path.join(frontend, "node_modules", entry.name);
    const destination = path.join(modules, entry.name);
    // next/font resolves font assets within the build root, so Geist needs real files here.
    if (entry.name === "geist" || !entry.isDirectory())
      await cp(source, destination, { recursive: true });
    else {
      await symlink(source, destination, "junction");
      links.push(destination);
    }
  }
  const child = spawn(
    process.execPath,
    [path.join(frontend, "node_modules/next/dist/bin/next"), "build"],
    {
      cwd: snapshot,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  process.exitCode = code;
} finally {
  const target = path.resolve(snapshot);
  if (
    path.dirname(target) !== snapshotParent ||
    !path.basename(target).startsWith("profile-build-")
  ) {
    throw new Error("Unexpected build cleanup directory.");
  }
  // Remove dependency junctions without traversing their targets.
  for (const link of links) await rmdir(link);
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
