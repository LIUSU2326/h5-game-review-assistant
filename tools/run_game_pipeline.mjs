import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const appRoot = process.env.H5_APP_ROOT ? path.resolve(process.env.H5_APP_ROOT) : root;
const args = parseArgs(process.argv.slice(2));
const gameId = args.gameId ?? args["game-id"] ?? "cow-saver";
const playSeconds = Number(args.playSeconds ?? args["play-seconds"] ?? 60);
const aiMode = args.ai ?? "local";
const aiEvalMode = args.aiEvalMode ?? args["ai-eval-mode"] ?? "low";
const maxImages = Number(args.maxImages ?? args["max-images"] ?? 2);
const writeFeishu = Boolean(args["write-feishu"]);
const createFields = args["create-fields"] !== "false";
const forceCollect = Boolean(args["force-collect"]);
const forceAi = Boolean(args["force-ai"]);
const failOnPartial = Boolean(args["fail-on-partial"]);
const retries = Number(args.retries ?? 1);
const stepTimeoutMs = Number(args.stepTimeoutMs ?? args["step-timeout-ms"] ?? 300000);
const collectTimeoutMs = Number(args.collectTimeoutMs ?? args["collect-timeout-ms"] ?? Math.max(240000, playSeconds * 4500 + 300000));
const traceMode = String(args.trace ?? "off");
const recordVideo = Boolean(args["record-video"]);
const videoSeconds = Number(args.videoSeconds ?? args["video-seconds"] ?? 0);
const playStrategy = String(args.playStrategy ?? args["play-strategy"] ?? "legacy_center_tap");
const gameDir = path.join(root, "evidence", gameId);
const outPath = path.join(gameDir, "pipeline_run.json");
process.stdout.on("error", ignorePipeError);
process.stderr.on("error", ignorePipeError);

await fs.mkdir(gameDir, { recursive: true });

const run = {
  started_at: new Date().toISOString(),
  finished_at: "",
  game_id: gameId,
  mode: {
    play_seconds: playSeconds,
    ai: aiMode,
    ai_eval_mode: aiEvalMode,
    max_images: maxImages,
    write_feishu: writeFeishu,
    create_fields: createFields,
    retries,
    step_timeout_ms: stepTimeoutMs,
    collect_timeout_ms: collectTimeoutMs,
    trace: traceMode,
    record_video: recordVideo,
    video_seconds: videoSeconds,
    play_strategy: playStrategy,
  },
  steps: [],
  status: "running",
};

try {
  if (forceCollect || !(await fileExists(path.join(gameDir, "report.zh.json")))) {
    await step(
      "collect",
      collectCommand(),
      { timeoutMs: collectTimeoutMs },
    );
  } else {
    skip("collect", "report.zh.json already exists");
  }

  await step("taxonomy_sync", nodeScript("tools/sync_taxonomy_from_feishu.mjs"), { allowFailure: true });

  if (forceAi || !(await fileExists(path.join(gameDir, "ai_eval.zh.json")))) {
    const aiArgs =
      aiMode === "live"
        ? nodeScript("tools/run_ai_eval.mjs", "--game-id", gameId)
        : nodeScript("tools/run_ai_eval.mjs", "--local-fallback", "--game-id", gameId);
    if (aiMode === "live") {
      aiArgs.push("--mode", aiEvalMode, "--max-images", String(maxImages));
    }
    await step("ai_eval", aiArgs);
  } else {
    skip("ai_eval", "ai_eval.zh.json already exists");
  }

  await step("feishu_preview", nodeScript("tools/build_feishu_payload_preview.mjs", "--game-id", gameId));
  await step("html_report", nodeScript("tools/build_local_report.mjs", "--game-id", gameId));

  const fieldsCheck = await step("feishu_fields_check", nodeScript("tools/check_feishu_table_fields.mjs"), { allowFailure: true });
  if (fieldsCheck.exit_code !== 0) {
    if (writeFeishu) {
      throw new Error("Feishu fields check command failed.");
    }
    skip("feishu_create_fields", "field check unavailable; write disabled");
    skip("feishu_write_dry_run", "field check unavailable; write disabled");
    skip("feishu_write_apply", "write disabled; Feishu config unavailable");
  } else {
    const fieldsReport = await readJsonOrNull(path.join(root, "config", "feishu_table_fields_check.json"));
    if (fieldsReport?.status === "missing_fields" && createFields) {
      await step("feishu_create_fields", nodeScript("tools/create_feishu_fields.mjs", "--apply"));
      await step("feishu_fields_recheck", nodeScript("tools/check_feishu_table_fields.mjs"));
    } else if (fieldsReport?.status === "missing_fields") {
      skip("feishu_create_fields", "missing fields found but --create-fields false was set");
    } else {
      skip("feishu_create_fields", `field status: ${fieldsReport?.status ?? "unknown"}`);
    }

    await step("feishu_write_dry_run", nodeScript("tools/write_feishu_record.mjs", "--game-id", gameId));
    if (writeFeishu) {
      await step("feishu_write_apply", nodeScript("tools/write_feishu_record.mjs", "--game-id", gameId, "--apply"));
    } else {
      skip("feishu_write_apply", "write disabled; pass --write-feishu to update Feishu");
    }
  }

  await step("workbench", nodeScript("tools/build_poc_workbench.mjs"));
  const collectionReport = await readJsonOrNull(path.join(gameDir, "report.zh.json"));
  if (collectionReport?.status && collectionReport.status !== "collected") {
    run.status = "success_with_review";
    run.review_notes = [`Collection status is ${collectionReport.status}. Check evidence screenshots before formal use.`];
  } else {
    run.status = "success";
  }
} catch (error) {
  run.status = "failed";
  run.error = {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
  };
} finally {
  run.finished_at = new Date().toISOString();
  await fs.writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(`Pipeline run written to ${outPath}`);
  console.log(`Status: ${run.status}`);
  if (run.status === "failed") process.exitCode = 1;
}

function collectCommand() {
  const command = nodeScript("tools/run_playwright_poc.mjs", "--game-id", gameId, "--play-seconds", String(playSeconds), "--trace", traceMode);
  if (playStrategy) command.push("--play-strategy", playStrategy);
  if (recordVideo && videoSeconds > 0) command.push("--record-video", "--video-seconds", String(videoSeconds));
  if (failOnPartial) command.push("--fail-on-partial");
  return command;
}

async function step(name, commandParts, options = {}) {
  const commandText = commandParts.join(" ");
  const entry = {
    name,
    command: commandText,
    status: "running",
    started_at: new Date().toISOString(),
    attempts: [],
  };
  run.steps.push(entry);
  console.log(`[pipeline] step started: ${name}`);

  const maxAttempts = Math.max(1, retries + 1);
  const timeoutMs = options.timeoutMs ?? stepTimeoutMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[pipeline] attempt ${attempt}/${maxAttempts}: ${name}`);
    const started = Date.now();
    const result = await runCommand(commandParts, timeoutMs, name);
    const attemptEntry = {
      attempt,
      exit_code: result.code,
      elapsed_ms: Date.now() - started,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr),
    };
    entry.attempts.push(attemptEntry);
    if (result.code === 0) {
      entry.status = "success";
      entry.finished_at = new Date().toISOString();
      entry.exit_code = 0;
      console.log(`[pipeline] step succeeded: ${name}`);
      return entry;
    }
    console.log(`[pipeline] step attempt failed: ${name} exit=${result.code}`);
  }

  const last = entry.attempts.at(-1);
  entry.status = options.allowFailure ? "failed_allowed" : "failed";
  entry.finished_at = new Date().toISOString();
  entry.exit_code = last?.exit_code ?? 1;
  console.log(`[pipeline] step ${entry.status}: ${name}`);
  if (!options.allowFailure) throw new Error(`Step failed: ${name}`);
  return entry;
}

function skip(name, reason) {
  console.log(`[pipeline] step skipped: ${name} (${reason})`);
  run.steps.push({
    name,
    status: "skipped",
    reason,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  });
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    if (arg.includes("=")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      parsed[key] = valueParts.join("=");
      continue;
    }
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function runCommand(commandParts, timeoutMs, stepName) {
  return new Promise((resolve) => {
    const { command, args: commandArgs } = spawnSpec(commandParts);
    const child = spawn(command, commandArgs, { cwd: root, shell: false, env: childProcessEnv() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      stderr += `\nCommand timed out after ${timeoutMs} ms. Terminating process tree.`;
      await terminateProcessTree(child.pid);
      settled = true;
      resolve({ code: 124, stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      safeWrite(process.stdout, prefixOutput(stepName, text));
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      safeWrite(process.stderr, prefixOutput(stepName, text));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });
}

function prefixOutput(stepName, text) {
  return text
    .split(/(\r?\n)/)
    .map((part) => {
      if (!part || part === "\n" || part === "\r\n") return part;
      return `[${stepName}] ${part}`;
    })
    .join("");
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

function terminateProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { shell: false });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    resolve();
  });
}

function spawnSpec(commandParts) {
  const [command, ...commandArgs] = commandParts;
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", commandParts.map(quoteWindowsArg).join(" ")],
    };
  }
  return { command, args: commandArgs };
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

function quoteWindowsArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function tail(value) {
  if (!value) return "";
  return value.length > 4000 ? value.slice(-4000) : value;
}
