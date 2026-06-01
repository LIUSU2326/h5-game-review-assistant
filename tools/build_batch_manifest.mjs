import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const appRoot = process.env.H5_APP_ROOT ? path.resolve(process.env.H5_APP_ROOT) : root;
const samplesPath = path.join(root, "samples", "games.csv");
const evidenceRoot = path.join(root, "evidence");
const batchDir = path.join(root, "batch");

await fs.mkdir(batchDir, { recursive: true });

const games = await readCsv(samplesPath);
const profiles = await readJsonFromCandidates([
  path.join(root, "config", "run_profiles.json"),
  path.join(appRoot, "config", "run_profiles.json"),
]);
const defaultProfile = profiles.default_profile;
const profile = profiles.profiles?.[defaultProfile] ?? { play_seconds: 60, ai_mode: "local" };
const duplicates = findDuplicates(games);
const tasks = [];

for (const game of games) {
  const gameDir = path.join(evidenceRoot, game.game_id);
  const hasCollection = await fileExists(path.join(gameDir, "report.zh.json"));
  const hasAi = await fileExists(path.join(gameDir, "ai_eval.zh.json"));
  const hasFeishuPreview = await fileExists(path.join(gameDir, "feishu_payload_preview.json"));
  const hasFeishuWrite = await fileExists(path.join(gameDir, "feishu_write_result.json"));
  const hasWorkbenchReport = await fileExists(path.join(gameDir, "report.html"));
  const hasPipelineRun = await fileExists(path.join(gameDir, "pipeline_run.json"));
  const duplicateIssues = [
    ...(duplicates.gameIds.get(game.game_id) ?? []),
    ...(duplicates.urls.get(normalizeUrl(game.url)) ?? []),
  ].filter((item) => item !== game);

  tasks.push({
    game_id: game.game_id,
    game_name: game.game_name,
    url: game.url,
    sample_status: game.status,
    duplicate_warning: duplicateIssues.length > 0,
    default_profile: defaultProfile,
    evidence_dir: path.relative(root, gameDir).replaceAll("\\", "/"),
    current_state: {
      collection_report: hasCollection,
      ai_eval: hasAi,
      feishu_payload_preview: hasFeishuPreview,
      feishu_write_result: hasFeishuWrite,
      html_report: hasWorkbenchReport,
      pipeline_run: hasPipelineRun,
    },
    pipeline_command: buildPipelineCommand(game.game_id, profile),
    next_recommended_command: recommendNextCommand({
      gameId: game.game_id,
      profile,
      hasCollection,
      hasAi,
      hasFeishuPreview,
      hasFeishuWrite,
      hasWorkbenchReport,
    }),
  });
}

const manifest = {
  generated_at: new Date().toISOString(),
  game_count: tasks.length,
  default_profile: defaultProfile,
  profiles: profiles.profiles,
  duplicate_summary: {
    duplicate_game_ids: [...duplicates.gameIds.entries()].filter(([, rows]) => rows.length > 1).map(([gameId, rows]) => ({ game_id: gameId, count: rows.length })),
    duplicate_urls: [...duplicates.urls.entries()].filter(([, rows]) => rows.length > 1).map(([url, rows]) => ({ url, count: rows.length })),
  },
  tasks,
};

const manifestPath = path.join(batchDir, "manifest.json");
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const markdown = buildMarkdown(manifest);
const markdownPath = path.join(batchDir, "run_plan.md");
await fs.writeFile(markdownPath, markdown, "utf8");

console.log(`Batch manifest written to ${manifestPath}`);
console.log(`Batch run plan written to ${markdownPath}`);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
      // Try the next location. Packaged builds keep defaults in appRoot and user data in root.
    }
  }
  throw new Error(`Could not find a readable JSON file: ${candidates.join(", ")}`);
}

function parseCsv(text) {
  const rows = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = parseCsvLine(rows.shift());
  return rows.filter(Boolean).map((row) => {
    const values = parseCsvLine(row);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
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

function recommendNextCommand({ gameId, profile: runProfile, hasCollection, hasAi, hasFeishuPreview, hasFeishuWrite, hasWorkbenchReport }) {
  if (!hasCollection) return `npm.cmd run poc:playwright -- --game-id ${gameId} --play-seconds ${runProfile.play_seconds}`;
  if (!hasAi) return `npm.cmd run ${runProfile.ai_mode === "live" ? "poc:ai" : "poc:ai:local"} -- --game-id ${gameId}`;
  if (!hasFeishuPreview) return `npm.cmd run poc:feishu:preview -- --game-id ${gameId}`;
  if (!hasFeishuWrite) return `npm.cmd run poc:feishu:write -- --game-id ${gameId} --apply`;
  if (!hasWorkbenchReport) return `npm.cmd run poc:report -- --game-id ${gameId}`;
  return "npm.cmd run poc:workbench";
}

function buildPipelineCommand(gameId, runProfile) {
  const aiMode = String(runProfile.ai_mode ?? "").includes("gemini") ? "live" : "local";
  const failOnPartial = runProfile.fail_on_partial ? " --fail-on-partial" : "";
  return `npm.cmd run poc:pipeline -- --game-id ${gameId} --play-seconds ${runProfile.play_seconds} --ai ${aiMode} --trace ${runProfile.trace ?? "off"} --write-feishu${failOnPartial}`;
}

function buildMarkdown(manifest) {
  const lines = [
    "# H5 Game Eval Batch Run Plan",
    "",
    `Generated: ${manifest.generated_at}`,
    `Game count: ${manifest.game_count}`,
    `Default profile: ${manifest.default_profile}`,
    "",
    "## Profiles",
    "",
    "| Profile | Per-Profile Seconds | Total Seconds | Task Retries | AI Mode | Description |",
    "|---|---:|---:|---:|---|---|",
  ];

  for (const [name, profile] of Object.entries(manifest.profiles)) {
    lines.push(`| ${name} | ${profile.play_seconds} | ${profile.total_play_seconds ?? profile.play_seconds} | ${profile.task_retries ?? 0} | ${profile.ai_mode} | ${profile.description} |`);
  }

  lines.push("", "## Duplicates", "");
  if (!manifest.duplicate_summary.duplicate_game_ids.length && !manifest.duplicate_summary.duplicate_urls.length) {
    lines.push("No duplicate game IDs or URLs detected.");
  } else {
    for (const item of manifest.duplicate_summary.duplicate_game_ids) lines.push(`- Duplicate game_id: ${item.game_id} (${item.count})`);
    for (const item of manifest.duplicate_summary.duplicate_urls) lines.push(`- Duplicate url: ${item.url} (${item.count})`);
  }

  lines.push("", "## Tasks", "", "| Game ID | Name | Duplicate | State | Pipeline Command | Next Command |", "|---|---|---|---|---|---|");

  for (const task of manifest.tasks) {
    const state = Object.entries(task.current_state)
      .map(([key, value]) => `${key}:${value ? "yes" : "no"}`)
      .join(", ");
    lines.push(`| ${task.game_id} | ${task.game_name} | ${task.duplicate_warning ? "yes" : "no"} | ${state} | \`${task.pipeline_command}\` | \`${task.next_recommended_command}\` |`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
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
