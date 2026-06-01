import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const appRoot = process.env.H5_APP_ROOT ? path.resolve(process.env.H5_APP_ROOT) : root;
process.stdout.on("error", ignorePipeError);
process.stderr.on("error", ignorePipeError);
const checks = [
  ["Gemini connection", nodeScript("tools/test_gemini_connection.mjs")],
  ["Feishu config", nodeScript("tools/check_feishu_config.mjs")],
  ["Feishu fields", nodeScript("tools/check_feishu_table_fields.mjs")],
  ["Taxonomy sync", nodeScript("tools/sync_taxonomy_from_feishu.mjs")],
];

let failed = false;

for (const [label, command] of checks) {
  console.log(`\n=== ${label} ===`);
  const result = await runCommand(command);
  if (result.code !== 0) {
    failed = true;
    console.error(`${label} failed with exit code ${result.code}`);
    break;
  }
}

process.exitCode = failed ? 1 : 0;

function runCommand(commandParts) {
  return new Promise((resolve) => {
    const { command, args } = spawnSpec(commandParts);
    const child = spawn(command, args, { cwd: root, shell: false, env: childProcessEnv() });
    child.stdout.on("data", (chunk) => safeWrite(process.stdout, chunk));
    child.stderr.on("data", (chunk) => safeWrite(process.stderr, chunk));
    child.on("close", (code) => resolve({ code }));
    child.on("error", (error) => {
      console.error(error.message);
      resolve({ code: 1 });
    });
  });
}

function safeWrite(stream, text) {
  if (!text || stream.destroyed || stream.writableEnded) return;
  try {
    stream.write(text);
  } catch (error) {
    if (error?.code !== "EPIPE") throw error;
  }
}

function ignorePipeError(error) {
  if (error?.code !== "EPIPE") {
    process.exitCode = process.exitCode || 1;
  }
}

function spawnSpec(commandParts) {
  const [command, ...args] = commandParts;
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", commandParts.map(quoteWindowsArg).join(" ")],
    };
  }
  return { command, args };
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function nodeScript(scriptPath, ...scriptArgs) {
  return [process.env.H5_NODE_EXECUTABLE || process.execPath, path.join(appRoot, scriptPath), ...scriptArgs];
}

function childProcessEnv() {
  const env = { ...process.env };
  env.H5_APP_ROOT = appRoot;
  env.H5_DATA_ROOT = root;
  if (env.H5_ELECTRON_RUN_AS_NODE === "1") env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}
