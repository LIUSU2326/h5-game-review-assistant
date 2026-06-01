import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(appRoot, ".build-temp");
const cacheRoot = path.join(appRoot, ".build-cache");
const electronCache = path.join(cacheRoot, "electron");
const electronBuilderCache = path.join(cacheRoot, "electron-builder");
const builderCli = path.join(appRoot, "node_modules", "electron-builder", "cli.js");

function assertInsideAppRoot(target, label) {
  const resolved = path.resolve(target);
  const relative = path.relative(appRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside app root: ${resolved}`);
  }
  return resolved;
}

async function main() {
  const safeTempRoot = assertInsideAppRoot(tempRoot, "Build temp");
  const safeCacheRoot = assertInsideAppRoot(cacheRoot, "Build cache");

  await rm(safeTempRoot, { recursive: true, force: true });
  await mkdir(safeTempRoot, { recursive: true });
  await mkdir(electronCache, { recursive: true });
  await mkdir(electronBuilderCache, { recursive: true });

  console.log(`Using build temp: ${safeTempRoot}`);
  console.log(`Using build cache: ${safeCacheRoot}`);

  const child = spawn(process.execPath, [builderCli, "--win", "portable"], {
    cwd: appRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      TEMP: safeTempRoot,
      TMP: safeTempRoot,
      TMPDIR: safeTempRoot,
      ELECTRON_CACHE: electronCache,
      ELECTRON_BUILDER_CACHE: electronBuilderCache,
    },
  });

  const code = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
    child.on("error", () => resolve(1));
  });

  if (code === 0) {
    await rm(safeTempRoot, { recursive: true, force: true });
  } else {
    console.error(`electron-builder failed. Temp files kept at: ${safeTempRoot}`);
  }

  process.exit(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
