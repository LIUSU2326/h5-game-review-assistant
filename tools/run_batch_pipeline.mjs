import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const appRoot = process.env.H5_APP_ROOT ? path.resolve(process.env.H5_APP_ROOT) : root;
const args = parseArgs(process.argv.slice(2));
const execute = Boolean(args.execute);
const profileName = String(args.profile ?? args["run-profile"] ?? "");
const selectedGameIds = splitList(args.gameIds ?? args["game-ids"]);
const writeFeishu = Boolean(args["write-feishu"]);
const forceCollect = Boolean(args["force-collect"]);
const forceAi = Boolean(args["force-ai"]);
const continueOnError = Boolean(args["continue-on-error"]);
const allowDuplicates = Boolean(args["allow-duplicates"]);
const cliFailOnPartial = Boolean(args["fail-on-partial"]);
const cliTaskRetries = args.taskRetries ?? args["task-retries"];
const playStrategyOverride = args.playStrategy ?? args["play-strategy"];
const commandTimeoutMs = Number(args.commandTimeoutMs ?? args["command-timeout-ms"] ?? 10800000);
process.stdout.on("error", ignorePipeError);
process.stderr.on("error", ignorePipeError);

const samplesPath = path.join(root, "samples", "games.csv");
const profilesPathCandidates = [
  path.join(root, "config", "run_profiles.json"),
  path.join(appRoot, "config", "run_profiles.json"),
];
const batchDir = path.join(root, "batch");
await fs.mkdir(batchDir, { recursive: true });

const games = await readCsv(samplesPath);
const profilesConfig = await readJsonFromCandidates(profilesPathCandidates);
const resolvedProfileName = profileName || profilesConfig.default_profile || "poc_review";
const profile = profilesConfig.profiles?.[resolvedProfileName];
if (!profile) throw new Error(`Unknown run profile: ${resolvedProfileName}`);
const failOnPartial = cliFailOnPartial || Boolean(profile.fail_on_partial);
const taskRetries = Math.max(0, Number(cliTaskRetries ?? profile.task_retries ?? 0));

const selectedSet = new Set(selectedGameIds);
const queuedGames = selectedSet.size ? games.filter((game) => selectedSet.has(game.game_id)) : games;
const missingSelected = selectedGameIds.filter((gameId) => !games.some((game) => game.game_id === gameId));
const duplicates = findDuplicates(games);
const outPath = path.join(batchDir, execute ? "last_run.json" : "dry_run.json");
const archiveDir = path.join(batchDir, "runs", archiveName(new Date(), execute ? "execute" : "dry-run", resolvedProfileName));
if (execute) await fs.mkdir(archiveDir, { recursive: true });

const runLog = {
  started_at: new Date().toISOString(),
  finished_at: "",
  status: execute ? "running" : "planned",
  mode: execute ? "execute" : "dry_run",
  profile_name: resolvedProfileName,
  profile,
  selected_game_ids: selectedGameIds,
  missing_selected_game_ids: missingSelected,
  options: {
    write_feishu: writeFeishu,
    force_collect: forceCollect,
    force_ai: forceAi,
    continue_on_error: continueOnError,
    allow_duplicates: allowDuplicates,
    fail_on_partial: failOnPartial,
    task_retries: taskRetries,
    play_strategy: playStrategyOverride || profile.play_strategy || "legacy_center_tap",
    command_timeout_ms: commandTimeoutMs,
  },
  archive_dir: execute ? path.relative(root, archiveDir).replaceAll("\\", "/") : "",
  totals: {
    queued: queuedGames.length,
    planned: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  },
  tasks: [],
};

if (missingSelected.length) {
  console.log(`[batch] missing game ids: ${missingSelected.join(", ")}`);
}

for (let index = 0; index < queuedGames.length; index += 1) {
  const game = queuedGames[index];
  const duplicateWarning = hasDuplicateWarning(duplicates, game);
  const command = buildPipelineCommand(game.game_id, profile);
  const entry = {
    index: index + 1,
    total: queuedGames.length,
    game_id: game.game_id,
    game_name: game.game_name,
    url: game.url,
    profile_name: resolvedProfileName,
    duplicate_warning: duplicateWarning,
    command: command.join(" "),
    status: execute ? "pending" : "planned",
    started_at: "",
    finished_at: "",
    elapsed_ms: 0,
    exit_code: null,
    attempts: [],
    stdout_tail: "",
    stderr_tail: "",
  };
  runLog.tasks.push(entry);
  runLog.totals.planned += 1;

  if (duplicateWarning && !allowDuplicates) {
    entry.status = "skipped_duplicate";
    entry.finished_at = new Date().toISOString();
    runLog.totals.skipped += 1;
    console.log(`[batch] (${entry.index}/${entry.total}) skipped duplicate: ${game.game_id}`);
    await writeRunLog();
    continue;
  }

  if (!execute) {
    console.log(`[batch] (${entry.index}/${entry.total}) planned: ${game.game_id}`);
    await writeRunLog();
    continue;
  }

  entry.status = "running";
  entry.started_at = new Date().toISOString();
  runLog.totals.running = 1;
  console.log(`[batch] (${entry.index}/${entry.total}) started: ${game.game_id}`);
  await writeRunLog();

  const started = Date.now();
  const result = await runTaskWithRetries(entry, command, commandTimeoutMs);
  entry.finished_at = new Date().toISOString();
  entry.elapsed_ms = Date.now() - started;
  entry.exit_code = result.code;
  entry.status = result.code === 0 ? "success" : "failed";
  entry.stdout_tail = tail(result.stdout);
  entry.stderr_tail = tail(result.stderr);
  runLog.totals.running = 0;
  runLog.totals[entry.status] += 1;
  console.log(`[batch] (${entry.index}/${entry.total}) ${entry.status}: ${game.game_id}`);
  await writeRunLog();

  if (result.code !== 0 && !continueOnError) {
    runLog.status = "failed";
    break;
  }
}

if (runLog.status === "running") {
  runLog.status = runLog.totals.failed > 0 ? "success_with_failures" : "success";
}
if (runLog.status === "planned") {
  runLog.totals.planned = runLog.tasks.filter((task) => task.status === "planned").length;
}
runLog.finished_at = new Date().toISOString();
await writeRunLog();
await writeArchiveRunLog();

console.log(`Batch ${runLog.mode} written to ${outPath}`);
if (runLog.archive_dir) console.log(`Batch archive written to ${path.join(root, runLog.archive_dir)}`);
console.log(`Status: ${runLog.status}`);
if (execute && runLog.totals.failed > 0 && !continueOnError) process.exitCode = 1;

async function runTaskWithRetries(entry, command, timeoutMs) {
  const maxAttempts = taskRetries + 1;
  let lastResult = { code: 1, stdout: "", stderr: "Task did not run." };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[batch] (${entry.index}/${entry.total}) attempt ${attempt}/${maxAttempts}: ${entry.game_id}`);
    const started = Date.now();
    const result = await runCommand(command, timeoutMs, entry.game_id);
    lastResult = result;
    const attemptEntry = {
      attempt,
      status: result.code === 0 ? "success" : "failed",
      exit_code: result.code,
      elapsed_ms: Date.now() - started,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr),
      stdout_log: "",
      stderr_log: "",
    };
    if (execute) {
      const logPaths = await writeAttemptLogs(entry, attempt, result);
      attemptEntry.stdout_log = logPaths.stdout;
      attemptEntry.stderr_log = logPaths.stderr;
    }
    entry.attempts.push(attemptEntry);
    entry.stdout_tail = attemptEntry.stdout_tail;
    entry.stderr_tail = attemptEntry.stderr_tail;
    await writeRunLog();
    if (result.code === 0) return result;
    if (attempt < maxAttempts) console.log(`[batch] (${entry.index}/${entry.total}) retrying after failure: ${entry.game_id}`);
  }
  return lastResult;
}

function buildPipelineCommand(gameId, runProfile) {
  const playSeconds = Number(runProfile.play_seconds ?? 60);
  const command = nodeScript(
    "tools/run_game_pipeline.mjs",
    "--game-id",
    gameId,
    "--play-seconds",
    String(playSeconds),
    "--ai",
    profileAiMode(runProfile),
    "--trace",
    String(runProfile.trace ?? "off"),
    "--ai-eval-mode",
    String(runProfile.ai_eval_mode ?? "low"),
    "--max-images",
    String(runProfile.max_images ?? 2),
  );
  command.push("--play-strategy", String(playStrategyOverride || runProfile.play_strategy || "legacy_center_tap"));
  if (writeFeishu) command.push("--write-feishu");
  if (forceCollect) command.push("--force-collect");
  if (forceAi) command.push("--force-ai");
  if (runProfile.record_video && Number(runProfile.video_seconds ?? 0) > 0) {
    command.push("--record-video", "--video-seconds", String(runProfile.video_seconds));
  }
  if (failOnPartial || playSeconds >= 1800) command.push("--fail-on-partial");
  return command;
}

function profileAiMode(runProfile) {
  return String(runProfile.ai_mode ?? "").includes("gemini") ? "live" : "local";
}

function runCommand(commandParts, timeoutMs, gameId) {
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
      safeWrite(process.stdout, prefixOutput(gameId, text));
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      safeWrite(process.stderr, prefixOutput(gameId, text));
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

function prefixOutput(gameId, text) {
  return text
    .split(/(\r?\n)/)
    .map((part) => {
      if (!part || part === "\n" || part === "\r\n") return part;
      return `[${gameId}] ${part}`;
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

async function terminateProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { shell: false });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

async function writeRunLog() {
  await fs.writeFile(outPath, `${JSON.stringify(runLog, null, 2)}\n`, "utf8");
  await writeArchiveRunLog();
}

async function writeArchiveRunLog() {
  if (!execute) return;
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.writeFile(path.join(archiveDir, "run.json"), `${JSON.stringify(runLog, null, 2)}\n`, "utf8");
}

async function writeAttemptLogs(entry, attempt, result) {
  const taskDir = path.join(archiveDir, `${String(entry.index).padStart(2, "0")}-${safeFileName(entry.game_id)}`);
  await fs.mkdir(taskDir, { recursive: true });
  const stdoutPath = path.join(taskDir, `attempt-${attempt}.stdout.log`);
  const stderrPath = path.join(taskDir, `attempt-${attempt}.stderr.log`);
  await fs.writeFile(stdoutPath, result.stdout || "", "utf8");
  await fs.writeFile(stderrPath, result.stderr || "", "utf8");
  return {
    stdout: path.relative(root, stdoutPath).replaceAll("\\", "/"),
    stderr: path.relative(root, stderrPath).replaceAll("\\", "/"),
  };
}

function archiveName(date, mode, profile) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${safeFileName(mode)}-${safeFileName(profile)}`;
}

function safeFileName(value) {
  return String(value ?? "unknown")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
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

function splitList(value) {
  return String(value ?? "")
    .split(/[,\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readCsv(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return parseCsv(text);
}

async function readJsonFromCandidates(candidates) {
  for (const filePath of candidates) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      // Try the next location.
    }
  }
  throw new Error(`Could not find a readable JSON file: ${candidates.join(", ")}`);
}

function parseCsv(text) {
  const rows = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = parseCsvLine(rows.shift() ?? "");
  return rows.filter(Boolean).map((row) => {
    const values = parseCsvLine(row);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function findDuplicates(rows) {
  const gameIds = new Map();
  const urls = new Map();
  for (const row of rows) {
    pushGroup(gameIds, row.game_id, row);
    pushGroup(urls, normalizeUrl(row.url), row);
  }
  return { gameIds, urls };
}

function hasDuplicateWarning(duplicates, game) {
  return (duplicates.gameIds.get(game.game_id)?.length ?? 0) > 1 || (duplicates.urls.get(normalizeUrl(game.url))?.length ?? 0) > 1;
}

function pushGroup(map, key, row) {
  if (!key) return;
  const list = map.get(key) ?? [];
  list.push(row);
  map.set(key, list);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return String(value ?? "").trim();
  }
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

function tail(value) {
  if (!value) return "";
  return value.length > 4000 ? value.slice(-4000) : value;
}
