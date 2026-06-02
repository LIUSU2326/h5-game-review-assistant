import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = process.env.H5_APP_ROOT
  ? path.resolve(process.env.H5_APP_ROOT)
  : process.env.H5_EVAL_ROOT
    ? path.resolve(process.env.H5_EVAL_ROOT)
    : process.cwd();
const dataRoot = process.env.H5_DATA_ROOT ? path.resolve(process.env.H5_DATA_ROOT) : appRoot;
const appDir = path.join(appRoot, "app");
const envPath = path.join(dataRoot, ".env");
const envExamplePath = path.join(dataRoot, ".env.example");
const appEnvExamplePath = path.join(appRoot, ".env.example");
const feishuPath = path.join(dataRoot, "config", "feishu.local.json");
const feishuTemplatePath = path.join(dataRoot, "config", "feishu.local.template.json");
const appFeishuTemplatePath = path.join(appRoot, "config", "feishu.local.template.json");
const fieldComposerPath = path.join(dataRoot, "config", "field_composer.json");
const fieldComposerDefaultsPath = path.join(appRoot, "config", "field_composer.defaults.json");
const fieldComposerDiffPath = path.join(dataRoot, "config", "field_composer_diff.json");
const fieldComposerApplyPath = path.join(dataRoot, "config", "field_composer_apply_result.json");
const samplesPath = path.join(dataRoot, "samples", "games.csv");
const taxonomySuggestionReviewPath = path.join(dataRoot, "config", "taxonomy_suggestion_review.json");
const taxonomyWritebackPreviewPath = path.join(dataRoot, "config", "taxonomy_writeback_preview.json");
const taxonomyWritebackResultPath = path.join(dataRoot, "config", "taxonomy_writeback_result.json");
const jobs = new Map();
const defaultPort = Number(process.env.PORT ?? process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? 4177);

export async function startAppServer({ port = defaultPort, host = "127.0.0.1" } = {}) {
  await initializeDataRoot();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }
      await handleStatic(response, url.pathname);
    } catch (error) {
      sendJson(response, 500, {
        error: error?.message ?? String(error),
      });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const url = `http://${host}:${actualPort}`;
      console.log(`H5 game eval app running at ${url}`);
      resolve({ server, url, port: actualPort });
    });
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await startAppServer();
}

async function initializeDataRoot() {
  for (const dir of ["batch", "config", "evidence", "logs", "mock_bitable", "outputs", "samples", "workbench"]) {
    await fs.mkdir(path.join(dataRoot, dir), { recursive: true });
  }

  await copyFileIfMissing(appEnvExamplePath, envExamplePath);
  await copyFileIfMissing(appFeishuTemplatePath, feishuTemplatePath);
  await copyFileIfMissing(fieldComposerDefaultsPath, fieldComposerPath);
  await copyFileIfMissing(path.join(appRoot, "config", "run_profiles.json"), path.join(dataRoot, "config", "run_profiles.json"));
  await copyFileIfMissing(path.join(appRoot, "config", "feishu.example.json"), path.join(dataRoot, "config", "feishu.example.json"));
  await copyFileIfMissing(path.join(appRoot, "config", "feishu_onboarding_checklist.json"), path.join(dataRoot, "config", "feishu_onboarding_checklist.json"));
  await copyDirFilesIfMissing(path.join(appRoot, "mock_bitable"), path.join(dataRoot, "mock_bitable"), (name) => name.endsWith(".csv"));
  await copyDirFilesIfMissing(path.join(appRoot, "samples"), path.join(dataRoot, "samples"), (name) => name.endsWith(".csv"));

  if (!(await fileExists(envPath)) && (await fileExists(envExamplePath))) {
    await fs.copyFile(envExamplePath, envPath);
  }
}

async function copyDirFilesIfMissing(sourceDir, targetDir, filter) {
  try {
    await fs.mkdir(targetDir, { recursive: true });
    const items = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isFile() || !filter(item.name)) continue;
      await copyFileIfMissing(path.join(sourceDir, item.name), path.join(targetDir, item.name));
    }
  } catch {
    // Optional scaffold directory may not exist in slim builds.
  }
}

async function copyFileIfMissing(sourcePath, targetPath) {
  if (await fileExists(targetPath)) return;
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  } catch {
    // Optional scaffold file may not exist in slim builds.
  }
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/status") {
    sendJson(response, 200, await buildStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config-workbench") {
    sendJson(response, 200, await buildConfigWorkbench());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/field-composer") {
    sendJson(response, 200, await buildFieldComposerWorkbench());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/field-composer") {
    const body = await readBody(request);
    sendJson(response, 200, await saveFieldComposer(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/field-composer/reset") {
    sendJson(response, 200, await resetFieldComposer());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/field-composer/diff") {
    sendJson(response, 200, await buildAndStoreFieldComposerDiff());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/field-composer/apply") {
    const body = await readBody(request);
    sendJson(response, 200, await applyFieldComposerSchema(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/taxonomy-suggestions") {
    sendJson(response, 200, await buildTaxonomySuggestionWorkbench());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/taxonomy-suggestions/review") {
    const body = await readBody(request);
    sendJson(response, 200, await saveTaxonomySuggestionReview(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/taxonomy-suggestions/writeback-preview") {
    sendJson(response, 200, await buildTaxonomyWritebackPreview());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/taxonomy-suggestions/writeback") {
    sendJson(response, 200, await writeAcceptedTaxonomySuggestionsToFeishu());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config") {
    const body = await readBody(request);
    await saveConfig(body);
    sendJson(response, 200, { status: "saved" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/games/import") {
    const body = await readBody(request);
    sendJson(response, 200, await importGames(body.urls ?? []));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/review") {
    const body = await readBody(request);
    sendJson(response, 200, await saveReview(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/evidence-package") {
    const body = await readBody(request);
    sendJson(response, 200, await createEvidencePackage(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/open-data-folder") {
    openFolder(dataRoot);
    sendJson(response, 200, { status: "opening", data_root: dataRoot });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/batch-report") {
    const body = await readBody(request);
    sendJson(response, 200, await createBatchReport(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/jobs") {
    sendJson(response, 200, { jobs: listJobs() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/jobs") {
    const body = await readBody(request);
    const job = startJob(body.action, body.options ?? {});
    sendJson(response, 200, { job: serializeJob(job) });
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    const job = cancelJob(cancelMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Job not found" });
      return;
    }
    sendJson(response, 200, { job: serializeJob(job) });
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Job not found" });
      return;
    }
    sendJson(response, 200, { job: serializeJob(job) });
    return;
  }

  sendJson(response, 404, { error: "Unknown API route" });
}

async function buildStatus() {
  const env = await readEnv();
  const feishu = await readJsonOrNull(feishuPath);
  const runProfiles = (await readJsonOrNull(path.join(dataRoot, "config", "run_profiles.json")))
    ?? (await readJsonOrNull(path.join(appRoot, "config", "run_profiles.json")))
    ?? {};
  const samples = await readSamples();
  const games = await Promise.all(samples.map((sample) => readGameStatus(sample, feishu)));
  const fieldsCheck = await readJsonOrNull(path.join(dataRoot, "config", "feishu_table_fields_check.json"));
  const taxonomy = await readJsonOrNull(path.join(dataRoot, "config", "taxonomy_from_feishu.json"));
  const geminiCheck = await readJsonOrNull(path.join(dataRoot, "config", "gemini_connection_check.json"));
  const latestBatchRun = await readJsonOrNull(path.join(dataRoot, "batch", "last_run.json"));
  const latestBatchDryRun = await readJsonOrNull(path.join(dataRoot, "batch", "dry_run.json"));
  const batchHistory = await readBatchHistory();
  const latestBatchRunSummary = summarizeBatchRun(latestBatchRun);
  const latestBatchDryRunSummary = summarizeBatchRun(latestBatchDryRun);
  const aiStatus = buildAiConfigStatus(env, geminiCheck);
  const activeAi = aiStatus.providers[aiStatus.active_provider] ?? aiStatus.providers.gemini;
  const ready = Boolean(
    activeAi?.api_key_configured &&
      activeAi?.runtime_ready &&
      feishu?.app_id &&
      feishu?.app_secret &&
      feishu?.bitable?.app_token &&
      feishu?.bitable?.tables?.evaluation_results?.table_id,
  );

  return {
    generated_at: new Date().toISOString(),
    app_root: appRoot,
    data_root: dataRoot,
    config: {
      ai: aiStatus,
      gemini: aiStatus.providers.gemini,
      feishu: {
        ready,
        app_id_configured: Boolean(feishu?.app_id),
        app_secret_configured: Boolean(feishu?.app_secret),
        app_id: feishu?.app_id ?? "",
        app_token: feishu?.bitable?.app_token ?? "",
        evaluation_table_id: feishu?.bitable?.tables?.evaluation_results?.table_id ?? "",
        taxonomy_table_id: feishu?.bitable?.tables?.taxonomy_options?.table_id ?? "",
        upload_screenshots: Boolean(feishu?.bitable?.upload_screenshots),
        fields_status: fieldsCheck?.status ?? "",
        fields_missing: fieldsCheck?.missing_fields?.length ?? 0,
        fields_type_warnings: fieldsCheck?.type_warnings?.length ?? 0,
        fields_type_warning_names: (fieldsCheck?.type_warnings ?? []).map((item) => item.field_name).filter(Boolean),
      },
      taxonomy: {
        status: taxonomy?.status ?? "",
        option_count: taxonomy?.option_count ?? 0,
      },
    },
    run_profiles: {
      default_profile: runProfiles.default_profile ?? "",
      profiles: runProfiles.profiles ?? {},
    },
    autoplay: buildAutoplayWorkbench({ env, runProfiles, games }),
    batch: {
      last_run: latestBatchRunSummary,
      dry_run: latestBatchDryRunSummary,
      history: batchHistory,
      production: buildBatchProductionOverview({
        history: batchHistory,
        latestRun: latestBatchRunSummary,
        latestDryRun: latestBatchDryRunSummary,
        samples,
      }),
    },
    games,
    summary: {
      latest_note: ready ? "配置已就绪，可以运行单款或批量评测" : "请先补齐 AI 模型和飞书配置",
    },
  };
}

function buildAiConfigStatus(env, geminiCheck) {
  const activeProvider = env.AI_PROVIDER || "gemini";
  return {
    active_provider: activeProvider,
    providers: {
      gemini: {
        api_key_configured: Boolean(env.GEMINI_API_KEY),
        model: env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
        proxy: env.GEMINI_PROXY ?? "",
        latest_check_status: geminiCheck?.status ?? "",
        runtime_ready: true,
      },
      openai_compatible: {
        api_key_configured: Boolean(env.OPENAI_API_KEY),
        model: env.OPENAI_MODEL ?? "",
        base_url: env.OPENAI_BASE_URL ?? "",
        latest_check_status: "",
        runtime_ready: false,
      },
      deepseek: {
        api_key_configured: Boolean(env.DEEPSEEK_API_KEY),
        model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
        base_url: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
        latest_check_status: "",
        runtime_ready: false,
      },
      openrouter: {
        api_key_configured: Boolean(env.OPENROUTER_API_KEY),
        model: env.OPENROUTER_MODEL ?? "",
        base_url: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
        latest_check_status: "",
        runtime_ready: false,
      },
    },
  };
}

const AUTOPLAY_STRATEGIES = [
  {
    id: "passive",
    label: "只观察",
    stage: "stable",
    level: "observe",
    tone: "warn",
    description: "不主动点击，只等待页面加载并采集截图，适合排查加载、广告遮挡和弱网首屏。",
    actions: ["等待", "截图", "视频"],
    api_cost: "不额外消耗 AI API",
    review_note: "可能停留在 Start 页，需要人工确认是否进入玩法。",
  },
  {
    id: "legacy_center_tap",
    label: "安全点击",
    stage: "stable",
    level: "basic",
    tone: "warn",
    description: "按固定中心区域轻量点击，兼容性高，但不理解按钮、教程和玩法目标。",
    actions: ["中心点击", "下方点击"],
    api_cost: "不额外消耗 AI API",
    review_note: "适合保守采集，不适合复杂教程或需要拖拽的游戏。",
  },
  {
    id: "guided_probe",
    label: "引导探测",
    stage: "default",
    level: "heuristic",
    tone: "good",
    description: "识别 Play、Start、Continue 等可见按钮，并在游戏区域内点击、拖拽和按方向键。",
    actions: ["按钮识别", "游戏区点击", "拖拽", "方向键"],
    api_cost: "不额外消耗 AI API",
    review_note: "当前推荐策略，适合大多数 H5 游戏的短档和正式档采集。",
  },
  {
    id: "adaptive_probe",
    label: "AI 预留探测",
    stage: "alpha",
    level: "vision-ready",
    tone: "info",
    description: "在引导探测基础上增加弹窗扫描、动作意图标记和更完整的动作日志，为后续多模态 AI 玩家预留。",
    actions: ["按钮识别", "弹窗扫描", "游戏区点击", "拖拽", "方向键", "动作日志"],
    api_cost: "当前不逐帧调用 Gemini；后续开启多模态决策后才会产生额外 API 消耗",
    review_note: "Alpha 策略，建议先用于单款或小批量验证，再进入正式 30 分钟档。",
  },
];

function buildAutoplayWorkbench({ env, runProfiles, games }) {
  const profiles = runProfiles.profiles ?? {};
  const defaultProfile = runProfiles.default_profile ?? Object.keys(profiles)[0] ?? "";
  const defaultStrategy = normalizeStrategyId(profiles[defaultProfile]?.play_strategy ?? "guided_probe");
  const aiActionEnabled = String(env.ENABLE_AI_ACTION ?? "false").toLowerCase() === "true";
  const apiKeyConfigured = Boolean(env.GEMINI_API_KEY);
  const latestActionCount = games.reduce((sum, game) => {
    const fromQuality = Number(game.collection_quality?.autoplay_action_count ?? NaN);
    if (Number.isFinite(fromQuality)) return sum + fromQuality;
    return sum + (game.autoplay?.runs ?? []).reduce((runSum, run) => runSum + Number(run.action_count ?? 0), 0);
  }, 0);
  const profileSummaries = Object.entries(profiles).map(([name, profile]) => ({
    name,
    strategy: normalizeStrategyId(profile.play_strategy ?? "legacy_center_tap"),
    strategy_label: strategyLabel(profile.play_strategy),
    play_seconds: Number(profile.play_seconds ?? 0),
    total_play_seconds: Number(profile.total_play_seconds ?? profile.play_seconds ?? 0),
    ai_mode: profile.ai_mode ?? "",
    record_video: Boolean(profile.record_video),
  }));
  const strategies = AUTOPLAY_STRATEGIES.map((strategy) => ({
    ...strategy,
    used_by_profiles: profileSummaries.filter((profile) => profile.strategy === strategy.id).map((profile) => profile.name),
    is_default: strategy.id === defaultStrategy,
  }));
  const current = strategies.find((strategy) => strategy.id === defaultStrategy) ?? strategies.find((strategy) => strategy.id === "guided_probe");
  const status = current?.id === "adaptive_probe" ? "alpha" : "ready";
  const statusLabel = status === "alpha" ? "Alpha 策略" : "可用";
  const copyText = [
    `AI 玩家状态：${statusLabel}`,
    `默认档位：${defaultProfile || "-"}`,
    `默认策略：${current?.label || defaultStrategy}`,
    `策略 ID：${current?.id || defaultStrategy}`,
    `当前执行方式：Playwright 启发式自动试玩`,
    `逐帧多模态决策：${aiActionEnabled && apiKeyConfigured ? "已预留，可后续开启" : "未开启"}`,
    `API 消耗：当前自动试玩不额外消耗 Gemini，仅 AI 评测步骤会调用 Gemini`,
    `历史动作记录：${latestActionCount} 次`,
  ].join("\n");
  return {
    status,
    status_label: statusLabel,
    provider: env.AI_PROVIDER ?? "gemini",
    model: env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
    api_key_configured: apiKeyConfigured,
    ai_action_enabled: aiActionEnabled,
    multimodal_ready: Boolean(aiActionEnabled && apiKeyConfigured),
    current_profile: defaultProfile,
    current_strategy: current?.id ?? defaultStrategy,
    current_strategy_label: current?.label ?? strategyLabel(defaultStrategy),
    action_provider: "Playwright heuristic",
    latest_action_count: latestActionCount,
    note: "当前自动试玩是浏览器启发式操作，不会用 Gemini 做逐帧决策。后续可在此基础上接入多模态 AI 玩家。",
    profiles: profileSummaries,
    strategies,
    copy_text: copyText,
  };
}

function normalizeStrategyId(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["passive", "legacy_center_tap", "guided_probe", "adaptive_probe"].includes(normalized)) return normalized;
  if (["legacy", "center", "center_tap"].includes(normalized)) return "legacy_center_tap";
  if (["adaptive", "agent", "ai_player", "agent_probe", "vision_ready"].includes(normalized)) return "adaptive_probe";
  if (["smart", "probe", "ai_probe", "guided"].includes(normalized)) return "guided_probe";
  return "legacy_center_tap";
}

function strategyLabel(value) {
  const labels = {
    passive: "只观察",
    legacy_center_tap: "安全点击",
    guided_probe: "引导探测",
    adaptive_probe: "AI 预留探测",
  };
  return labels[normalizeStrategyId(value)] ?? value ?? "-";
}

async function buildConfigWorkbench() {
  const feishu = (await readJsonOrNull(feishuPath)) ?? {};
  const fieldsCheck = await readJsonOrNull(path.join(dataRoot, "config", "feishu_table_fields_check.json"));
  const taxonomy = await readJsonOrNull(path.join(dataRoot, "config", "taxonomy_from_feishu.json"));
  const mappingFile =
    feishu?.bitable?.tables?.evaluation_results?.field_mapping_file ?? "mock_bitable/feishu_field_mapping.csv";
  const mappingPath = resolveDataFile(mappingFile);
  const mappingText = await readTextOrNull(mappingPath);
  const fieldMappings = await readCsvOrEmpty(mappingPath);
  const remoteFields = fieldsCheck?.remote_fields ?? [];
  const remoteByName = new Map(remoteFields.map((field) => [field.field_name, field]));
  const warningsByName = new Map((fieldsCheck?.type_warnings ?? []).map((field) => [field.field_name, field]));

  const fields = fieldMappings.map((field) => {
    const remote = remoteByName.get(field.field_name);
    const warning = warningsByName.get(field.field_name);
    const issues = [];
    if (!remote) issues.push("missing_remote_field");
    if (warning) issues.push("type_warning");
    if (!field.source_path) issues.push("missing_source_path");
    if (field.required === "true" && !field.feishu_type) issues.push("missing_type");
    return {
      field_name: field.field_name,
      source_path: field.source_path,
      feishu_type: field.feishu_type,
      required: field.required === "true",
      notes: field.notes ?? "",
      remote_field_id: remote?.field_id ?? "",
      remote_type: remote?.type_label ?? "",
      issues,
    };
  });
  const expectedNames = new Set(fields.map((field) => field.field_name));
  const extraRemoteFields = remoteFields
    .filter((field) => !expectedNames.has(field.field_name))
    .map((field) => ({
      field_name: field.field_name,
      remote_type: field.type_label ?? "",
      issue: "remote_extra_field",
      severity: "info",
      message: "飞书表格里存在映射表未使用的字段，不影响写入。",
    }));
  const fieldDiagnostics = [
    ...fields.flatMap((field) => field.issues.map((issue) => fieldDiagnostic(field, issue))),
    ...extraRemoteFields,
  ];

  const taxonomyCategories = Object.entries(taxonomy?.categories ?? {}).map(([category, options]) => {
    const list = Array.isArray(options) ? options : [];
    return {
      category,
      total: list.length,
      enabled: list.filter((option) => option.enabled).length,
      sample_options: list.slice(0, 8).map((option) => ({
        id: option.id,
        name_en: option.name_en,
        name_zh: option.name_zh,
        enabled: option.enabled,
      })),
      options: list.map((option) => ({
        id: option.id,
        parent_id: option.parent_id,
        level: option.level,
        name_en: option.name_en,
        name_zh: option.name_zh,
        enabled: option.enabled,
        description_zh: option.description_zh,
        record_id: option.record_id,
      })),
    };
  });
  const templateAudit = buildTemplateAudit({
    fields,
    fieldDiagnostics,
    fieldsCheck,
    mappingFile,
    mappingPath,
    mappingText,
    remoteFields,
    taxonomy,
    taxonomyCategories,
  });

  return {
    generated_at: new Date().toISOString(),
    mapping_file: path.relative(dataRoot, mappingPath).replaceAll("\\", "/"),
    template_audit: templateAudit,
    field_summary: {
      status: fieldsCheck?.status ?? "unchecked",
      total_expected: fields.length,
      required: fields.filter((field) => field.required).length,
      optional: fields.filter((field) => !field.required).length,
      remote_total: remoteFields.length,
      missing_remote: fields.filter((field) => field.issues.includes("missing_remote_field")).length,
      type_warnings: fields.filter((field) => field.issues.includes("type_warning")).length,
      source_missing: fields.filter((field) => field.issues.includes("missing_source_path")).length,
      extra_remote: extraRemoteFields.length,
      by_type: countBy(fields, "feishu_type"),
      by_source: countBy(fields.map((field) => ({ source: field.source_path.split(".")[0] || "unknown" })), "source"),
    },
    fields,
    diagnostics: {
      total: fieldDiagnostics.length,
      blocking: fieldDiagnostics.filter((item) => item.severity === "bad").length,
      warnings: fieldDiagnostics.filter((item) => item.severity === "warn").length,
      info: fieldDiagnostics.filter((item) => item.severity === "info").length,
      items: fieldDiagnostics,
      copy_text: buildFieldDiagnosticsCopyText({
        fields,
        fieldSummaryStatus: fieldsCheck?.status ?? "unchecked",
        fieldDiagnostics,
        taxonomy,
      }),
    },
    taxonomy_summary: {
      status: taxonomy?.status ?? "unchecked",
      option_count: taxonomy?.option_count ?? 0,
      enabled_count: taxonomy?.enabled_count ?? 0,
      category_count: taxonomyCategories.length,
      synced_at: taxonomy?.synced_at ?? taxonomy?.checked_at ?? "",
    },
    taxonomy_categories: taxonomyCategories,
  };
}

async function buildFieldComposerWorkbench() {
  const composer = await readFieldComposer();
  const lastDiff = await readJsonOrNull(fieldComposerDiffPath);
  const lastApply = await readJsonOrNull(fieldComposerApplyPath);
  return {
    generated_at: new Date().toISOString(),
    composer,
    summary: summarizeFieldComposer(composer),
    last_diff: lastDiff,
    last_apply: lastApply,
  };
}

async function readFieldComposer() {
  const defaults = await readJsonOrNull(fieldComposerDefaultsPath);
  const saved = await readJsonOrNull(fieldComposerPath);
  const source = saved?.fields?.length ? saved : defaults;
  const normalized = normalizeFieldComposer(source ?? { categories: [], fields: [] }, defaults ?? {});
  if (!(await fileExists(fieldComposerPath))) {
    await fs.mkdir(path.dirname(fieldComposerPath), { recursive: true });
    await fs.writeFile(fieldComposerPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }
  return normalized;
}

function normalizeFieldComposer(source, defaults = {}) {
  const defaultFieldsById = new Map((defaults.fields ?? []).map((field) => [field.id, field]));
  const fields = (source.fields ?? defaults.fields ?? []).map((field) => {
    const fallback = defaultFieldsById.get(field.id) ?? {};
    return {
      ...fallback,
      ...field,
      id: String(field.id ?? fallback.id ?? "").trim(),
      field_name: String(field.field_name ?? fallback.field_name ?? "").trim(),
      label_zh: String(field.label_zh ?? fallback.label_zh ?? field.field_name ?? "").trim(),
      source_path: String(field.source_path ?? fallback.source_path ?? "").trim(),
      feishu_type: normalizeFeishuFieldType(field.feishu_type ?? fallback.feishu_type),
      required: Boolean(field.required ?? fallback.required),
      option_category: String(field.option_category ?? fallback.option_category ?? "").trim(),
    };
  }).filter((field) => field.id && field.field_name);
  const fieldIds = new Set(fields.map((field) => field.id));
  const categories = (source.categories ?? defaults.categories ?? []).map((category) => ({
    id: String(category.id ?? "").trim(),
    label_zh: String(category.label_zh ?? category.table_name ?? "").trim(),
    table_name: String(category.table_name ?? category.label_zh ?? "").trim(),
    description: String(category.description ?? "").trim(),
    field_ids: [...new Set((category.field_ids ?? []).map((id) => String(id).trim()).filter((id) => fieldIds.has(id)))],
  })).filter((category) => category.id && category.table_name);
  return {
    version: source.version ?? defaults.version ?? "1.0",
    updated_at: source.updated_at ?? "",
    categories,
    fields,
  };
}

async function saveFieldComposer(body) {
  const current = await readFieldComposer();
  const incoming = normalizeFieldComposer(body?.composer ?? body ?? current, current);
  incoming.updated_at = new Date().toISOString();
  await fs.mkdir(path.dirname(fieldComposerPath), { recursive: true });
  await fs.writeFile(fieldComposerPath, `${JSON.stringify(incoming, null, 2)}\n`, "utf8");
  await clearFieldComposerComputedState();
  return buildFieldComposerWorkbench();
}

async function resetFieldComposer() {
  const defaults = normalizeFieldComposer(await readJsonOrNull(fieldComposerDefaultsPath) ?? {});
  defaults.updated_at = new Date().toISOString();
  await fs.mkdir(path.dirname(fieldComposerPath), { recursive: true });
  await fs.writeFile(fieldComposerPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
  await clearFieldComposerComputedState();
  return buildFieldComposerWorkbench();
}

async function clearFieldComposerComputedState() {
  await Promise.all([
    fs.rm(fieldComposerDiffPath, { force: true }).catch(() => null),
    fs.rm(fieldComposerApplyPath, { force: true }).catch(() => null),
  ]);
}

function summarizeFieldComposer(composer) {
  const assigned = new Set(composer.categories.flatMap((category) => category.field_ids ?? []));
  const activeFields = composer.fields.filter((field) => assigned.has(field.id));
  const fieldsById = new Map(composer.fields.map((field) => [field.id, field]));
  const activeFieldRefs = composer.categories
    .flatMap((category) => category.field_ids ?? [])
    .map((id) => fieldsById.get(id))
    .filter(Boolean);
  const activeFieldSlots = composer.categories.reduce((sum, category) => sum + (category.field_ids ?? []).length, 0);
  return {
    category_count: composer.categories.length,
    total_fields: composer.fields.length,
    active_fields: activeFieldSlots,
    unique_active_fields: activeFields.length,
    inactive_fields: Math.max(0, composer.fields.length - activeFields.length),
    multi_select_fields: activeFieldRefs.filter((field) => field.feishu_type === "multi_select").length,
    single_select_fields: activeFieldRefs.filter((field) => field.feishu_type === "single_select").length,
    tables: composer.categories.map((category) => ({
      id: category.id,
      table_name: category.table_name,
      field_count: (category.field_ids ?? []).length,
    })),
  };
}

async function buildAndStoreFieldComposerDiff() {
  const composer = await readFieldComposer();
  const diff = await buildFieldComposerDiff(composer);
  await fs.mkdir(path.dirname(fieldComposerDiffPath), { recursive: true });
  await fs.writeFile(fieldComposerDiffPath, `${JSON.stringify(diff, null, 2)}\n`, "utf8");
  return diff;
}

async function applyFieldComposerSchema(body = {}) {
  if (!body?.confirm) {
    return {
      generated_at: new Date().toISOString(),
      status: "confirmation_required",
      message: "需要用户二次确认后才会创建飞书表或字段。",
    };
  }

  const composer = await readFieldComposer();
  const feishu = await readJsonOrNull(feishuPath);
  const appToken = feishu?.bitable?.app_token ?? "";
  const selectedFields = new Map(composer.fields.map((field) => [field.id, field]));
  const result = {
    generated_at: new Date().toISOString(),
    status: "pending",
    preflight_status: "",
    summary_before: {},
    summary_after: {},
    created_tables: [],
    created_fields: [],
    skipped_fields: [],
    failed_items: [],
    type_conflicts: [],
    note: "只新增缺失的飞书数据表和字段；不会删除飞书已有字段，也不会修改已有字段类型。",
  };

  const preflight = await buildFieldComposerDiff(composer);
  result.preflight_status = preflight.status;
  result.summary_before = preflight.summary ?? {};

  if (!feishu?.app_id || !feishu?.app_secret || !appToken) {
    result.status = "needs_feishu_config";
    return saveFieldComposerApplyResult(result, preflight);
  }
  if (preflight.status === "blocked_type_conflict") {
    result.status = "blocked_type_conflict";
    result.type_conflicts = preflight.type_conflicts ?? [];
    return saveFieldComposerApplyResult(result, preflight);
  }
  if (preflight.status === "failed") {
    result.status = "failed";
    result.failed_items.push({ scope: "preflight", message: preflight.error?.message ?? "读取飞书结构失败。" });
    return saveFieldComposerApplyResult(result, preflight);
  }
  if (preflight.status === "needs_feishu_config") {
    result.status = "needs_feishu_config";
    return saveFieldComposerApplyResult(result, preflight);
  }
  if (!(preflight.summary?.missing_tables || preflight.summary?.missing_fields)) {
    result.status = "nothing_to_create";
    return saveFieldComposerApplyResult(result, preflight);
  }

  try {
    const accessToken = await getTenantAccessToken(feishu.app_id, feishu.app_secret);
    const remoteTables = await listFeishuTables(accessToken, appToken);
    const remoteTableByName = new Map(remoteTables.map((table) => [normalizeComparableText(table.name), table]));

    for (const category of composer.categories) {
      const expectedFields = (category.field_ids ?? []).map((id) => selectedFields.get(id)).filter(Boolean);
      if (!expectedFields.length) continue;

      let remoteTable = remoteTableByName.get(normalizeComparableText(category.table_name));
      if (!remoteTable) {
        try {
          remoteTable = await createFeishuTable(accessToken, appToken, category.table_name, fieldDefinitionForComposer(expectedFields[0]));
          remoteTableByName.set(normalizeComparableText(category.table_name), remoteTable);
          result.created_tables.push({
            category_id: category.id,
            table_name: category.table_name,
            table_id: remoteTable.table_id,
          });
          await delay(500);
        } catch (error) {
          result.failed_items.push({
            scope: "table",
            table_name: category.table_name,
            message: error?.message ?? String(error),
            code: error?.code,
          });
          continue;
        }
      }

      let remoteFields = [];
      try {
        remoteFields = await listFeishuFields(accessToken, appToken, remoteTable.table_id);
      } catch (error) {
        result.failed_items.push({
          scope: "fields",
          table_name: category.table_name,
          table_id: remoteTable.table_id,
          message: error?.message ?? String(error),
          code: error?.code,
        });
        continue;
      }

      const remoteFieldNames = new Set(remoteFields.map((field) => normalizeComparableText(field.field_name)));
      for (const field of expectedFields) {
        if (remoteFieldNames.has(normalizeComparableText(field.field_name))) {
          result.skipped_fields.push({
            table_name: category.table_name,
            field_name: field.field_name,
            reason: "already_exists",
          });
          continue;
        }
        try {
          const created = await createFeishuField(accessToken, appToken, remoteTable.table_id, fieldDefinitionForComposer(field));
          remoteFieldNames.add(normalizeComparableText(created.field_name || field.field_name));
          result.created_fields.push({
            table_name: category.table_name,
            table_id: remoteTable.table_id,
            field_name: created.field_name || field.field_name,
            field_id: created.field_id ?? "",
            type: created.type || fieldTypeCodeForComposer(field.feishu_type),
            type_label: fieldTypeLabelForComposer(created.type || fieldTypeCodeForComposer(field.feishu_type)),
          });
          await delay(160);
        } catch (error) {
          result.failed_items.push({
            scope: "field",
            table_name: category.table_name,
            table_id: remoteTable.table_id,
            field_name: field.field_name,
            message: error?.message ?? String(error),
            code: error?.code,
          });
        }
      }
    }

    const createdCount = result.created_tables.length + result.created_fields.length;
    if (result.failed_items.length) result.status = createdCount ? "partial_failed" : "failed";
    else result.status = createdCount ? "created" : "nothing_to_create";
    const latestDiff = await buildFieldComposerDiff(composer);
    result.summary_after = latestDiff.summary ?? {};
    return saveFieldComposerApplyResult(result, latestDiff);
  } catch (error) {
    result.status = "failed";
    result.failed_items.push({
      scope: "apply",
      message: error?.message ?? String(error),
      code: error?.code,
    });
    return saveFieldComposerApplyResult(result, preflight);
  }
}

async function saveFieldComposerApplyResult(result, diff) {
  await fs.mkdir(path.dirname(fieldComposerApplyPath), { recursive: true });
  await fs.writeFile(fieldComposerApplyPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.mkdir(path.dirname(fieldComposerDiffPath), { recursive: true });
  await fs.writeFile(fieldComposerDiffPath, `${JSON.stringify(diff, null, 2)}\n`, "utf8");
  return { result, diff };
}

async function buildFieldComposerDiff(composer) {
  const feishu = await readJsonOrNull(feishuPath);
  const appToken = feishu?.bitable?.app_token ?? "";
  const selectedFields = new Map(composer.fields.map((field) => [field.id, field]));
  const result = {
    generated_at: new Date().toISOString(),
    status: "unknown",
    summary: {
      selected_tables: composer.categories.filter((category) => (category.field_ids ?? []).length > 0).length,
      selected_fields: composer.categories.reduce((sum, category) => sum + (category.field_ids ?? []).length, 0),
      remote_tables: 0,
      missing_tables: 0,
      missing_fields: 0,
      extra_remote_fields: 0,
      type_conflicts: 0,
    },
    tables: [],
    missing_tables: [],
    missing_fields: [],
    extra_remote_fields: [],
    type_conflicts: [],
    next_prompt: [],
  };

  if (!feishu?.app_id || !feishu?.app_secret || !appToken) {
    result.status = "needs_feishu_config";
    result.next_prompt.push("先完成飞书 App ID、App Secret 和多维表格链接配置。");
    return result;
  }

  try {
    const accessToken = await getTenantAccessToken(feishu.app_id, feishu.app_secret);
    const remoteTables = await listFeishuTables(accessToken, appToken);
    result.summary.remote_tables = remoteTables.length;
    const remoteTableByName = new Map(remoteTables.map((table) => [normalizeComparableText(table.name), table]));

    for (const category of composer.categories) {
      const expectedFieldIds = category.field_ids ?? [];
      if (!expectedFieldIds.length) continue;
      const expectedFields = expectedFieldIds.map((id) => selectedFields.get(id)).filter(Boolean);
      const remoteTable = remoteTableByName.get(normalizeComparableText(category.table_name));
      const tableResult = {
        category_id: category.id,
        label_zh: category.label_zh,
        table_name: category.table_name,
        table_id: remoteTable?.table_id ?? "",
        status: remoteTable ? "matched" : "missing_table",
        expected_field_count: expectedFields.length,
        remote_field_count: 0,
        missing_fields: [],
        extra_remote_fields: [],
        type_conflicts: [],
      };

      if (!remoteTable) {
        result.missing_tables.push({
          category_id: category.id,
          table_name: category.table_name,
          expected_field_count: expectedFields.length,
        });
        tableResult.missing_fields = expectedFields.map((field) => field.field_name);
        result.tables.push(tableResult);
        continue;
      }

      const remoteFields = await listFeishuFields(accessToken, appToken, remoteTable.table_id);
      tableResult.remote_field_count = remoteFields.length;
      const remoteByName = new Map(remoteFields.map((field) => [normalizeComparableText(field.field_name), field]));
      const expectedNames = new Set(expectedFields.map((field) => normalizeComparableText(field.field_name)));

      for (const field of expectedFields) {
        const remote = remoteByName.get(normalizeComparableText(field.field_name));
        if (!remote) {
          const item = {
            category_id: category.id,
            table_name: category.table_name,
            field_id: field.id,
            field_name: field.field_name,
            label_zh: field.label_zh,
            expected_type: field.feishu_type,
          };
          tableResult.missing_fields.push(item.field_name);
          result.missing_fields.push(item);
          continue;
        }
        const accepted = acceptedFieldTypesForComposer(field.feishu_type);
        if (accepted.length && !accepted.includes(Number(remote.type))) {
          const item = {
            category_id: category.id,
            table_name: category.table_name,
            field_id: field.id,
            field_name: field.field_name,
            label_zh: field.label_zh,
            expected_type: field.feishu_type,
            remote_type: Number(remote.type),
            remote_type_label: fieldTypeLabelForComposer(remote.type),
          };
          tableResult.type_conflicts.push(item.field_name);
          result.type_conflicts.push(item);
        }
      }

      for (const remote of remoteFields) {
        if (expectedNames.has(normalizeComparableText(remote.field_name))) continue;
        const item = {
          category_id: category.id,
          table_name: category.table_name,
          field_name: remote.field_name,
          remote_type: Number(remote.type),
          remote_type_label: fieldTypeLabelForComposer(remote.type),
          behavior: "ignore_and_leave_empty",
        };
        tableResult.extra_remote_fields.push(item.field_name);
        result.extra_remote_fields.push(item);
      }

      if (tableResult.type_conflicts.length) tableResult.status = "type_conflict";
      else if (tableResult.missing_fields.length) tableResult.status = "needs_new_fields";
      else tableResult.status = "ready";
      result.tables.push(tableResult);
    }

    result.summary.missing_tables = result.missing_tables.length;
    result.summary.missing_fields = result.missing_fields.length;
    result.summary.extra_remote_fields = result.extra_remote_fields.length;
    result.summary.type_conflicts = result.type_conflicts.length;
    if (result.type_conflicts.length) {
      result.status = "blocked_type_conflict";
      result.next_prompt.push("存在字段类型冲突，需要用户确认后手动处理，工具暂不自动改已有字段类型。");
    } else if (result.missing_tables.length || result.missing_fields.length) {
      result.status = "needs_confirmation";
      result.next_prompt.push("有超出飞书当前结构的表或字段，写入前需要二次确认是否创建。");
    } else {
      result.status = "ready";
      result.next_prompt.push("飞书结构与当前字段编排匹配，可以进入写入流程。");
    }
    if (result.extra_remote_fields.length) {
      result.next_prompt.push("飞书表里存在未选字段，工具不会删除这些字段，也不会写入这些列。");
    }
    return result;
  } catch (error) {
    result.status = "failed";
    result.error = {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
    };
    result.next_prompt.push("读取飞书远端结构失败，请检查应用权限、文档应用授权和网络。");
    return result;
  }
}

async function listFeishuTables(accessToken, appToken) {
  const tables = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable tables", json);
    tables.push(...(json.data?.items ?? []).map((table) => ({
      ...table,
      table_id: table.table_id ?? table.id ?? "",
      name: table.name ?? table.table_name ?? "",
    })));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return tables;
}

async function listFeishuFields(accessToken, appToken, tableId) {
  const fields = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable fields", json);
    fields.push(...(json.data?.items ?? []).map((field) => ({
      ...field,
      field_id: field.field_id ?? field.id ?? "",
      field_name: field.field_name ?? field.name ?? "",
      type: Number(field.type),
    })));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return fields;
}

async function createFeishuTable(accessToken, appToken, tableName, firstFieldDefinition) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`);
  url.searchParams.set("client_token", crypto.randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", {
    table: {
      name: tableName,
      default_view_name: "Grid",
      fields: [firstFieldDefinition],
    },
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create Bitable table", json);
  const table = json.data?.table ?? json.data ?? {};
  return {
    ...table,
    table_id: table.table_id ?? table.id ?? "",
    name: table.name ?? table.table_name ?? tableName,
  };
}

async function createFeishuField(accessToken, appToken, tableId, definition) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`);
  url.searchParams.set("client_token", crypto.randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", definition);
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create Bitable field", json);
  const field = json.data?.field ?? json.data ?? {};
  return {
    ...field,
    field_id: field.field_id ?? field.id ?? "",
    field_name: field.field_name ?? field.name ?? definition.field_name,
    type: Number(field.type ?? definition.type),
  };
}

function fieldDefinitionForComposer(field) {
  return {
    field_name: field.field_name,
    type: fieldTypeCodeForComposer(field.feishu_type),
  };
}

function fieldTypeCodeForComposer(type) {
  const normalized = normalizeFeishuFieldType(type);
  if (normalized === "number") return 2;
  if (normalized === "single_select") return 3;
  if (normalized === "multi_select") return 4;
  if (normalized === "checkbox") return 7;
  if (normalized === "url") return 15;
  if (normalized === "attachment") return 17;
  return 1;
}

function normalizeFeishuFieldType(value) {
  const normalized = String(value ?? "text").trim();
  return ["text", "long_text", "number", "single_select", "multi_select", "checkbox", "url", "attachment"].includes(normalized)
    ? normalized
    : "text";
}

function acceptedFieldTypesForComposer(type) {
  const normalized = normalizeFeishuFieldType(type);
  if (normalized === "number") return [2];
  if (normalized === "single_select") return [3];
  if (normalized === "multi_select") return [4];
  if (normalized === "checkbox") return [7];
  if (normalized === "url") return [1, 15];
  if (normalized === "attachment") return [17];
  if (normalized === "text" || normalized === "long_text") return [1];
  return [];
}

function fieldTypeLabelForComposer(type) {
  const labels = new Map([
    [1, "Text"],
    [2, "Number"],
    [3, "Single Select"],
    [4, "Multi Select"],
    [7, "Checkbox"],
    [15, "URL"],
    [17, "Attachment"],
  ]);
  return labels.get(Number(type)) ?? "Unknown";
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildTemplateAudit({ fields, fieldDiagnostics, fieldsCheck, mappingFile, mappingPath, mappingText, remoteFields, taxonomy, taxonomyCategories }) {
  const missing = fields.filter((field) => field.issues.includes("missing_remote_field"));
  const typeWarnings = fields.filter((field) => field.issues.includes("type_warning"));
  const sourceMissing = fields.filter((field) => field.issues.includes("missing_source_path"));
  const blocking = fieldDiagnostics.filter((item) => item.severity === "bad");
  const warnings = fieldDiagnostics.filter((item) => item.severity === "warn");
  const normalizedRemote = [...remoteFields]
    .map((field) => ({
      field_name: field.field_name,
      type: field.type,
      type_label: field.type_label,
    }))
    .sort((a, b) => a.field_name.localeCompare(b.field_name));
  const mappingHash = sha256(mappingText ?? "");
  const remoteHash = sha256(JSON.stringify(normalizedRemote));
  const taxonomyHash = sha256(JSON.stringify(
    taxonomyCategories
      .map((category) => ({
        category: category.category,
        total: category.total,
        enabled: category.enabled,
        ids: (category.options ?? []).map((option) => option.id).sort(),
      }))
      .sort((a, b) => a.category.localeCompare(b.category)),
  ));
  const status = templateAuditStatus({ fieldsCheck, missing, typeWarnings, sourceMissing, taxonomy });
  const statusLabel = templateAuditStatusLabel(status);
  const version = `tpl-${fields.length}-${mappingHash.slice(0, 8)}`;
  const nextActions = templateAuditNextActions({ status, missing, typeWarnings, sourceMissing, taxonomy });
  const copyText = [
    `模板版本：${version}`,
    `状态：${statusLabel}`,
    `字段映射：${mappingFile}`,
    `预期字段：${fields.length}`,
    `飞书字段：${remoteFields.length}`,
    `缺失字段：${missing.length}`,
    `类型风险：${typeWarnings.length}`,
    `来源缺失：${sourceMissing.length}`,
    `标签选项：${taxonomy?.option_count ?? 0}`,
    `Mapping SHA256：${mappingHash}`,
    `Remote Schema SHA256：${remoteHash}`,
    `Taxonomy SHA256：${taxonomyHash}`,
    nextActions.length ? `下一步：${nextActions.join("；")}` : "下一步：可用于写入和批量评测",
  ].join("\n");
  return {
    status,
    status_label: statusLabel,
    version,
    mapping_file: mappingFile,
    mapping_path: path.relative(dataRoot, mappingPath).replaceAll("\\", "/"),
    mapping_sha256: mappingHash,
    remote_schema_sha256: remoteHash,
    taxonomy_sha256: taxonomyHash,
    expected_fields: fields.length,
    required_fields: fields.filter((field) => field.required).length,
    remote_fields: remoteFields.length,
    missing_fields: missing.length,
    type_warnings: typeWarnings.length,
    source_missing: sourceMissing.length,
    blocking_issues: blocking.length,
    warning_issues: warnings.length,
    taxonomy_options: taxonomy?.option_count ?? 0,
    taxonomy_synced_at: taxonomy?.synced_at ?? taxonomy?.checked_at ?? "",
    checked_at: fieldsCheck?.checked_at ?? "",
    next_actions: nextActions,
    copy_text: copyText,
  };
}

function templateAuditStatus({ fieldsCheck, missing, typeWarnings, sourceMissing, taxonomy }) {
  if (!fieldsCheck || !fieldsCheck.status) return "unchecked";
  if (fieldsCheck.status === "failed") return "failed";
  if (missing.length) return "missing_fields";
  if (typeWarnings.length) return "type_warnings";
  if (sourceMissing.length) return "source_missing";
  if (!taxonomy?.option_count) return "taxonomy_unchecked";
  return "aligned";
}

function templateAuditStatusLabel(status) {
  return {
    aligned: "模板一致",
    unchecked: "待检查",
    failed: "检查失败",
    missing_fields: "缺字段",
    type_warnings: "类型风险",
    source_missing: "来源缺失",
    taxonomy_unchecked: "标签待同步",
  }[status] || status || "未知";
}

function templateAuditNextActions({ status, missing, typeWarnings, sourceMissing, taxonomy }) {
  if (status === "aligned") return [];
  const actions = [];
  if (status === "unchecked") actions.push("先运行快速检查或检查字段");
  if (status === "failed") actions.push("检查飞书凭证、应用权限和文档应用授权");
  if (missing.length) actions.push(`创建或修正 ${missing.length} 个飞书字段`);
  if (typeWarnings.length) actions.push(`核对 ${typeWarnings.length} 个字段类型`);
  if (sourceMissing.length) actions.push(`补充 ${sourceMissing.length} 个字段来源路径`);
  if (!taxonomy?.option_count) actions.push("同步标签库或导入 Taxonomy Options");
  return actions;
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

async function buildTaxonomySuggestionWorkbench() {
  const reviews = (await readJsonOrNull(taxonomySuggestionReviewPath)) ?? { items: {} };
  const suggestions = await collectTaxonomySuggestions();
  const merged = suggestions.map((item) => {
    const review = reviews.items?.[item.id] ?? {};
    return {
      ...item,
      review_status: review.status ?? "pending",
      review_notes: review.notes ?? "",
      reviewed_at: review.updated_at ?? "",
    };
  });
  const summary = {
    total: merged.length,
    pending: merged.filter((item) => item.review_status === "pending").length,
    accepted: merged.filter((item) => item.review_status === "accepted").length,
    accepted_actionable: merged.filter((item) => item.review_status === "accepted" && item.is_actionable).length,
    rejected: merged.filter((item) => item.review_status === "rejected").length,
    needs_info: merged.filter((item) => item.review_status === "needs_info").length,
    preflight: merged.filter((item) => item.source === "taxonomy_preflight").length,
    games: new Set(merged.flatMap((item) => item.games.map((game) => game.game_id))).size,
  };
  return {
    generated_at: new Date().toISOString(),
    summary,
    items: merged,
  };
}

async function collectTaxonomySuggestions() {
  const samples = await readSamples().catch(() => []);
  const sampleNames = new Map(samples.map((sample) => [sample.game_id, sample.game_name]));
  const evidenceDir = path.join(dataRoot, "evidence");
  const dirs = await fs.readdir(evidenceDir, { withFileTypes: true }).catch(() => []);
  const grouped = new Map();
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const gameId = dir.name;
    const gameName = sampleNames.get(gameId) || titleCase(gameId);
    const gameDir = path.join(evidenceDir, gameId);
    const en = await readJsonOrNull(path.join(gameDir, "ai_eval.en.json"));
    const zh = await readJsonOrNull(path.join(gameDir, "ai_eval.zh.json"));
    const preview = await readJsonOrNull(path.join(gameDir, "feishu_payload_preview.json"));
    const candidates = [
      ...normalizeEnTaxonomySuggestions(en?.result?.taxonomy_new_suggestions ?? []),
      ...normalizeZhTaxonomySuggestions(zh?.result ?? {}),
      ...normalizePreflightTaxonomySuggestions(preview?.taxonomy_preflight),
    ];
    for (const candidate of candidates) {
      if (!candidate.suggestion) continue;
      const id = taxonomySuggestionId(candidate);
      const existing = grouped.get(id) ?? {
        ...candidate,
        id,
        games: [],
      };
      existing.games.push({ game_id: gameId, game_name: gameName });
      grouped.set(id, existing);
    }
  }
  return [...grouped.values()].sort((a, b) => {
    const statusOrder = Number(a.is_actionable) === Number(b.is_actionable) ? 0 : a.is_actionable ? -1 : 1;
    if (statusOrder) return statusOrder;
    return `${a.field}:${a.suggestion}`.localeCompare(`${b.field}:${b.suggestion}`);
  });
}

function normalizeEnTaxonomySuggestions(items) {
  return items
    .filter((item) => item && item.field !== "required_taxonomy_repair")
    .map((item) => ({
      field: item.field ?? "unknown",
      suggestion: item.suggestion ?? "",
      reason: item.reason ?? "",
      language: "en",
      source: item.source ?? "ai",
      is_actionable: true,
    }));
}

function normalizeZhTaxonomySuggestions(result) {
  const fields = ["audience", "game_type", "sub_type", "theme", "art_style", "feature_tags", "controls"];
  return fields.flatMap((field) => {
    const values = result?.[field]?.new_suggestions ?? [];
    return values.map((item) => ({
      field: item.field ?? field,
      suggestion: item.suggestion ?? item.name_zh ?? item.id ?? "",
      reason: item.reason ?? "",
      language: "zh",
      source: "ai",
      is_actionable: !item.id,
      existing_option_id: item.id ?? "",
    }));
  });
}

function normalizePreflightTaxonomySuggestions(preflight) {
  const missing = preflight?.missing_options ?? [];
  return missing.map((item) => ({
    field: item.field_name ?? item.field ?? "",
    suggestion: item.suggestion ?? item.option ?? "",
    reason: `飞书标签库缺少 ${item.category_label_zh || taxonomyCategoryDisplayName(item.category)} 选项，来源于写入预检。`,
    language: "en",
    source: "taxonomy_preflight",
    category: item.category ?? "",
    category_label_zh: item.category_label_zh ?? "",
    is_actionable: true,
  }));
}

function taxonomySuggestionId(item) {
  return crypto
    .createHash("sha1")
    .update([item.language, taxonomyCategoryForField(item.field) || item.category || item.field, item.suggestion, item.source || "", item.reason].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

async function saveTaxonomySuggestionReview(body) {
  const allowed = new Set(["pending", "accepted", "rejected", "needs_info"]);
  const id = String(body.id ?? "");
  if (!id) throw new Error("Missing taxonomy suggestion id.");
  const status = allowed.has(body.status) ? body.status : "pending";
  const notes = String(body.notes ?? "");
  const reviews = (await readJsonOrNull(taxonomySuggestionReviewPath)) ?? { items: {} };
  reviews.items ??= {};
  reviews.items[id] = {
    status,
    notes,
    updated_at: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(taxonomySuggestionReviewPath), { recursive: true });
  await fs.writeFile(taxonomySuggestionReviewPath, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");
  return { status: "saved", item: { id, ...reviews.items[id] } };
}

async function buildTaxonomyWritebackPreview() {
  const workbench = await buildTaxonomySuggestionWorkbench();
  const accepted = (workbench.items ?? []).filter((item) => item.review_status === "accepted" && item.is_actionable);
  const records = accepted.map((item) => taxonomySuggestionToRecord(item, workbench.items ?? [])).filter(Boolean);
  const preview = {
    generated_at: new Date().toISOString(),
    status: records.length ? "ready_for_review" : "empty",
    accepted_count: accepted.length,
    record_count: records.length,
    records,
    note: "Preview only. No Feishu data was changed.",
  };
  await fs.mkdir(path.dirname(taxonomyWritebackPreviewPath), { recursive: true });
  await fs.writeFile(taxonomyWritebackPreviewPath, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  return preview;
}

async function writeAcceptedTaxonomySuggestionsToFeishu() {
  const feishu = await readJsonOrNull(feishuPath);
  const appToken = feishu?.bitable?.app_token ?? "";
  const tableId = feishu?.bitable?.tables?.taxonomy_options?.table_id ?? "";
  assertFeishuTaxonomyConfig(feishu, appToken, tableId);

  const preview = await buildTaxonomyWritebackPreview();
  const taxonomy = await readJsonOrNull(path.join(dataRoot, "config", "taxonomy_from_feishu.json"));
  const localExisting = buildLocalTaxonomyKeySet(taxonomy);
  const token = await getTenantAccessToken(feishu.app_id, feishu.app_secret);
  const remoteRecords = await listFeishuRecords(token, appToken, tableId);
  const remoteExisting = buildRemoteTaxonomyRecordMap(remoteRecords);
  const result = {
    generated_at: new Date().toISOString(),
    status: "pending",
    preview_status: preview.status,
    attempted_count: preview.record_count,
    created_count: 0,
    updated_count: 0,
    skipped_count: 0,
    failed_count: 0,
    items: [],
    note: "Only accepted taxonomy suggestions are written. Existing local or remote options are skipped, unless a duplicate record is missing bilingual labels that can be safely filled.",
  };

  for (const record of preview.records ?? []) {
    const keys = taxonomyRecordKeys(record.fields);
    const item = {
      suggestion_id: record.suggestion_id,
      category: record.fields.Category,
      option_id: record.fields["Option ID"],
      name_en: record.fields["Name EN"],
      name_zh: record.fields["Name ZH"],
      status: "pending",
      record_id: "",
      reason: "",
    };
    try {
      const remoteDuplicateKey = keys.find((key) => remoteExisting.has(key));
      const duplicateKey = keys.find((key) => localExisting.has(key) || remoteExisting.has(key));
      if (duplicateKey) {
        const remoteDuplicate = remoteDuplicateKey ? remoteExisting.get(remoteDuplicateKey) : null;
        const enrichment = remoteDuplicate ? missingTaxonomyFieldUpdates(remoteDuplicate.fields ?? {}, record.fields) : {};
        if (remoteDuplicate?.record_id && Object.keys(enrichment).length) {
          await updateFeishuRecord(token, appToken, tableId, remoteDuplicate.record_id, enrichment);
          remoteDuplicate.fields = { ...(remoteDuplicate.fields ?? {}), ...enrichment };
          addTaxonomyKeysToMap(remoteExisting, remoteDuplicate);
          item.status = "updated_existing";
          item.record_id = remoteDuplicate.record_id;
          item.reason = `Filled missing fields: ${Object.keys(enrichment).join(", ")}`;
          result.updated_count += 1;
        } else {
          item.status = "skipped_duplicate";
          item.reason = `Duplicate taxonomy option: ${duplicateKey}`;
          result.skipped_count += 1;
        }
      } else {
        const created = await createFeishuRecord(token, appToken, tableId, record.fields);
        item.status = "created";
        item.record_id = created.record_id ?? created.id ?? "";
        result.created_count += 1;
        addTaxonomyKeysToMap(remoteExisting, { record_id: item.record_id, fields: record.fields });
      }
    } catch (error) {
      item.status = "failed";
      item.reason = error?.message ?? String(error);
      result.failed_count += 1;
    }
    result.items.push(item);
  }

  if (!result.attempted_count) result.status = "empty";
  else if (result.failed_count) result.status = result.created_count ? "partial_failed" : "failed";
  else if (result.created_count) result.status = "written";
  else if (result.updated_count) result.status = "updated";
  else result.status = "skipped";

  await fs.mkdir(path.dirname(taxonomyWritebackResultPath), { recursive: true });
  await fs.writeFile(taxonomyWritebackResultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (result.created_count || result.updated_count) {
    await runAppTool("tools/sync_taxonomy_from_feishu.mjs").catch(() => null);
  }
  return result;
}

function taxonomySuggestionToRecord(item, allItems = []) {
  const category = item.category || taxonomyCategoryForField(item.field);
  if (!category) return null;
  const paired = pairedTaxonomySuggestion(item, allItems);
  const nameEn = item.language === "en" ? item.suggestion : paired?.language === "en" ? paired.suggestion : "";
  const nameZh = item.language === "zh" ? item.suggestion : paired?.language === "zh" ? paired.suggestion : "";
  const optionId = `${category}_${slugifyOption(nameEn || item.suggestion)}`;
  const gameNames = (item.games ?? []).map((game) => game.game_name || game.game_id).join(", ");
  return {
    suggestion_id: item.id,
    fields: {
      Category: category,
      "Option ID": optionId,
      "Parent ID": "",
      Level: "",
      "Name EN": nameEn,
      "Name ZH": nameZh,
      Enabled: true,
      "Description ZH": item.reason || `AI suggestion from ${gameNames}`,
      "Source File": `taxonomy_suggestion_review:${item.id}`,
    },
    source_games: item.games ?? [],
  };
}

function pairedTaxonomySuggestion(item, allItems) {
  const category = item.category || taxonomyCategoryForField(item.field);
  const sameSource = (candidate) => {
    if (candidate.id === item.id) return false;
    if (!candidate.is_actionable) return false;
    if ((candidate.category || taxonomyCategoryForField(candidate.field)) !== category) return false;
    if (candidate.language === item.language) return false;
    if (!sameGameSet(candidate.games ?? [], item.games ?? [])) return false;
    if (item.language === "en") return candidate.language === "zh" && containsCjk(candidate.suggestion);
    if (item.language === "zh") return candidate.language === "en" && !containsCjk(candidate.suggestion);
    return false;
  };
  const matches = allItems.filter(sameSource);
  return matches.length === 1 ? matches[0] : null;
}

function sameGameSet(left, right) {
  const normalize = (items) => items.map((item) => item.game_id || item.game_name || "").filter(Boolean).sort().join("|");
  return normalize(left) === normalize(right);
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value ?? ""));
}

function assertFeishuTaxonomyConfig(config, appToken, tableId) {
  if (!config?.app_id || !config?.app_secret) {
    throw new Error("Feishu App ID or App Secret is missing.");
  }
  if (!appToken) throw new Error("Feishu app_token is missing.");
  if (!tableId) throw new Error("Taxonomy Options table_id is missing.");
}

function buildLocalTaxonomyKeySet(taxonomy) {
  const keys = new Set();
  for (const [category, options] of Object.entries(taxonomy?.categories ?? {})) {
    for (const option of Array.isArray(options) ? options : []) {
      addTaxonomyKeys(keys, {
        Category: category,
        "Option ID": option.id,
        "Name EN": option.name_en,
        "Name ZH": option.name_zh,
      });
    }
  }
  return keys;
}

function buildRemoteTaxonomyRecordMap(records) {
  const map = new Map();
  for (const record of records) addTaxonomyKeysToMap(map, record);
  return map;
}

function addTaxonomyKeysToMap(map, record) {
  for (const key of taxonomyRecordKeys(record.fields ?? {})) map.set(key, record);
}

function addTaxonomyKeys(keys, fields) {
  for (const key of taxonomyRecordKeys(fields)) keys.add(key);
}

function missingTaxonomyFieldUpdates(existingFields, proposedFields) {
  const updates = {};
  for (const fieldName of ["Name EN", "Name ZH", "Description ZH"]) {
    if (!stringifyValue(existingFields[fieldName]).trim() && stringifyValue(proposedFields[fieldName]).trim()) {
      updates[fieldName] = proposedFields[fieldName];
    }
  }
  return updates;
}

function taxonomyRecordKeys(fields) {
  const category = normalizeComparableText(fields.Category);
  const optionId = normalizeComparableText(fields["Option ID"]);
  const nameEn = normalizeComparableText(fields["Name EN"]);
  const nameZh = normalizeComparableText(fields["Name ZH"]);
  return [
    optionId ? `${category}::id::${optionId}` : "",
    nameEn ? `${category}::en::${nameEn}` : "",
    nameZh ? `${category}::zh::${nameZh}` : "",
  ].filter(Boolean);
}

function normalizeComparableText(value) {
  return stringifyValue(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function stringifyValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.text) return stringifyValue(value.text);
    if (value.value) return stringifyValue(value.value);
    if (value.name) return stringifyValue(value.name);
    if (value.link) return stringifyValue(value.link);
  }
  return JSON.stringify(value);
}

async function getTenantAccessToken(appId, appSecret) {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to get tenant_access_token", json);
  return json.tenant_access_token;
}

async function listFeishuRecords(accessToken, appToken, tableId) {
  const records = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list taxonomy records", json);
    records.push(...(json.data?.items ?? []).map((record) => ({
      ...record,
      record_id: record.record_id ?? record.id ?? "",
      fields: record.fields ?? {},
    })));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return records;
}

async function createFeishuRecord(accessToken, appToken, tableId, fields) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`);
  url.searchParams.set("client_token", crypto.randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", { fields });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create taxonomy record", json);
  return json.data?.record ?? json.data ?? {};
}

async function updateFeishuRecord(accessToken, appToken, tableId, recordId, fields) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`);
  const response = await feishuFetch(url, accessToken, "PUT", { fields });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to update taxonomy record", json);
  return json.data?.record ?? json.data ?? {};
}

async function feishuFetch(url, accessToken, method, body) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function createFeishuError(prefix, responseJson) {
  const message = responseJson?.msg || responseJson?.message || JSON.stringify(responseJson);
  return new Error(`${prefix}: ${message}`);
}

function taxonomyCategoryForField(field) {
  const normalized = String(field ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["audience", "target_audience"].includes(normalized)) return "audiences";
  if (["game_type", "sub_type", "subgenre"].includes(normalized)) return "gameplay_types";
  if (normalized === "theme") return "themes";
  if (normalized === "art_style") return "art_styles";
  if (normalized === "feature_tags") return "feature_tags";
  if (normalized === "controls") return "controls";
  return "";
}

function taxonomyCategoryDisplayName(category) {
  return {
    audiences: "人群",
    gameplay_types: "玩法",
    themes: "题材",
    art_styles: "画风",
    feature_tags: "特色标签",
    controls: "操作",
  }[category] || category || "标签";
}

function slugifyOption(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "option";
}

function fieldDiagnostic(field, issue) {
  const common = {
    field_name: field.field_name,
    source_path: field.source_path,
    feishu_type: field.feishu_type,
    issue,
  };
  if (issue === "missing_remote_field") {
    return {
      ...common,
      severity: "bad",
      message: "飞书表格缺少这个字段，写入前需要创建或修正字段名。",
    };
  }
  if (issue === "type_warning") {
    return {
      ...common,
      severity: "warn",
      message: "飞书远端字段类型和本地映射预期不完全一致。",
    };
  }
  if (issue === "missing_source_path") {
    return {
      ...common,
      severity: "warn",
      message: "字段映射缺少来源路径，后续生成 Payload 时需要检查。",
    };
  }
  return {
    ...common,
    severity: "warn",
    message: "字段映射需要检查。",
  };
}

function buildFieldDiagnosticsCopyText({ fields, fieldSummaryStatus, fieldDiagnostics, taxonomy }) {
  const lines = [
    "H5 游戏评测助手字段诊断",
    `字段状态：${fieldSummaryStatus || "unchecked"}`,
    `预期字段：${fields.length}`,
    `必填字段：${fields.filter((field) => field.required).length}`,
    `诊断项：${fieldDiagnostics.length}`,
    `标签库：${taxonomy?.status ?? "unchecked"}，${taxonomy?.option_count ?? 0} 项`,
    "",
  ];
  if (!fieldDiagnostics.length) {
    lines.push("当前未发现字段缺失或类型风险。");
  } else {
    lines.push("诊断明细：");
    for (const item of fieldDiagnostics) {
      lines.push(`- [${item.severity}] ${item.field_name}: ${item.message}`);
    }
  }
  return lines.join("\n");
}

async function readGameStatus(sample, feishuConfig = {}) {
  const gameDir = path.join(dataRoot, "evidence", sample.game_id);
  const reportPath = path.join(gameDir, "report.html");
  const payloadPath = path.join(gameDir, "feishu_payload_preview.json");
  const collectionPath = path.join(gameDir, "report.zh.json");
  const aiZhPath = path.join(gameDir, "ai_eval.zh.json");
  const aiEnPath = path.join(gameDir, "ai_eval.en.json");
  const writePath = path.join(gameDir, "feishu_write_result.json");
  const collection = await readJsonOrNull(collectionPath);
  const aiZh = await readJsonOrNull(aiZhPath);
  const aiEn = await readJsonOrNull(aiEnPath);
  const preview = await readJsonOrNull(payloadPath);
  const dryRun = await readJsonOrNull(path.join(gameDir, "feishu_write_dry_run.json"));
  const write = await readJsonOrNull(writePath);
  const writeFresh = write ? await isResultFresh(writePath, [collectionPath, aiZhPath, aiEnPath, payloadPath]) : false;
  const review = await readJsonOrNull(path.join(gameDir, "review_status.json"));
  const autoplay = await readJsonOrNull(path.join(gameDir, "autoplay_manifest.json"));
  const videoManifest = await readJsonOrNull(path.join(gameDir, "video", "manifest.json"));
  const screenshotUpload = await readJsonOrNull(path.join(gameDir, "screenshot_upload_result.json"));
  const screenshotUploadSummary = buildScreenshotUploadStatus({
    config: feishuConfig,
    write: writeFresh ? write : null,
    dryRun,
    standaloneUpload: screenshotUpload,
  });
  const screenshots = (collection?.screenshots ?? []).map((item) => ({
    name: item,
    href: `/evidence/${encodeURIComponent(sample.game_id)}/${item.split("/").map(encodeURIComponent).join("/")}`,
  }));
  const videos = (collection?.videos ?? []).map((item) => ({
    name: item,
    href: `/evidence/${encodeURIComponent(sample.game_id)}/${item.split("/").map(encodeURIComponent).join("/")}`,
  }));

  return {
    ...sample,
    collection_status: collection?.status ?? "missing",
    collection_quality: collection?.collection_quality ?? null,
    autoplay: autoplay ?? collection?.autoplay ?? null,
    evaluation_source: aiEn?.evaluation_source ?? aiZh?.evaluation_source ?? "",
    ai_model: aiEn?.model ?? aiZh?.model ?? "",
    feishu_preview_status: preview?.status ?? "",
    taxonomy_preflight: preview?.taxonomy_preflight ?? null,
    feishu_write_status: writeFresh ? (write?.status ?? "") : (dryRun?.status ?? ""),
    feishu_write_stale: Boolean(write && !writeFresh),
    record_id: writeFresh ? (write?.record_id ?? "") : "",
    screenshot_upload: screenshotUploadSummary,
    screenshot_upload_status: screenshotUploadSummary.status,
    video_status: videoManifest?.status ?? "",
    review: review ?? {
      status: "pending",
      notes: "",
      updated_at: "",
    },
    ai_zh: aiZh,
    ai_en: aiEn,
    screenshots,
    videos,
    report_exists: await fileExists(reportPath),
    payload_exists: await fileExists(payloadPath),
    report_href: `/evidence/${encodeURIComponent(sample.game_id)}/report.html`,
    payload_href: `/evidence/${encodeURIComponent(sample.game_id)}/feishu_payload_preview.json`,
  };
}

function buildScreenshotUploadStatus({ config, write, dryRun, standaloneUpload }) {
  const enabled = Boolean(config?.bitable?.upload_screenshots);
  const writeSummary = write?.screenshot_upload ?? dryRun?.screenshot_upload ?? null;
  const standaloneSummary = summarizeStandaloneScreenshotUpload(standaloneUpload);
  const summary = writeSummary ?? standaloneSummary ?? {};
  const status = summary.status || (enabled ? "not_written" : "disabled");
  const attachmentCount = Number(summary.attachment_count ?? standaloneSummary?.attachment_count ?? 0);
  return {
    enabled,
    status,
    uploaded_count: Number(summary.uploaded_count ?? standaloneSummary?.uploaded_count ?? 0),
    reused_count: Number(summary.reused_count ?? standaloneSummary?.reused_count ?? 0),
    failed_count: Number(summary.failed_count ?? standaloneSummary?.failed_count ?? 0),
    attachment_count: attachmentCount,
    can_view_in_feishu: enabled && attachmentCount > 0 && ["ready", "partial_failed"].includes(status),
    field_name: "Screenshot Attachments",
    fallback_field_name: "Screenshots",
    storage: standaloneUpload?.storage ?? (enabled ? "feishu_bitable_attachment" : "local_path"),
    report_file: summary.report_file ?? "",
  };
}

function summarizeStandaloneScreenshotUpload(upload) {
  if (!upload) return null;
  const files = upload.files ?? [];
  return {
    status: upload.status ?? "",
    uploaded_count: files.filter((item) => item.status === "uploaded").length,
    reused_count: files.filter((item) => item.status === "reused").length,
    failed_count: files.filter((item) => item.status === "failed").length,
    attachment_count: files.filter((item) => item.file_token).length,
  };
}

async function isResultFresh(resultPath, sourcePaths) {
  const resultStat = await statOrNull(resultPath);
  if (!resultStat) return false;
  for (const sourcePath of sourcePaths) {
    const sourceStat = await statOrNull(sourcePath);
    if (sourceStat && sourceStat.mtimeMs > resultStat.mtimeMs + 1000) return false;
  }
  return true;
}

async function saveReview(body) {
  const gameId = String(body.gameId ?? body.game_id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(gameId)) {
    throw new Error("Invalid game id.");
  }
  const allowed = new Set(["pending", "approved", "needs_changes"]);
  const status = allowed.has(body.status) ? body.status : "pending";
  let review = {
    game_id: gameId,
    status,
    notes: String(body.notes ?? "").slice(0, 4000),
    updated_at: new Date().toISOString(),
  };
  const gameDir = path.join(dataRoot, "evidence", gameId);
  await fs.mkdir(gameDir, { recursive: true });
  await fs.writeFile(path.join(gameDir, "review_status.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  const feishuSync = body.syncFeishu === false
    ? { status: "skipped", reason: "sync_disabled" }
    : await syncReviewToFeishu(gameId);
  review = {
    ...review,
    feishu_sync: feishuSync,
  };
  await fs.writeFile(path.join(gameDir, "review_status.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  return { status: "saved", review };
}

async function createEvidencePackage(body) {
  const gameId = String(body.gameId ?? body.game_id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(gameId)) {
    throw new Error("Invalid game id.");
  }

  const gameDir = path.join(dataRoot, "evidence", gameId);
  const gameStat = await statOrNull(gameDir);
  if (!gameStat?.isDirectory()) {
    throw new Error(`Evidence folder not found for ${gameId}.`);
  }

  const outDir = path.join(dataRoot, "outputs", "evidence-packages");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const zipName = `${gameId}-evidence-${stamp}.zip`;
  const zipPath = path.join(outDir, zipName);

  await compressEvidenceFolder(gameDir, zipPath);
  const stat = await fs.stat(zipPath);
  return {
    status: "created",
    game_id: gameId,
    file_name: zipName,
    size_bytes: stat.size,
    href: `/outputs/evidence-packages/${encodeURIComponent(zipName)}`,
    local_path: zipPath,
    created_at: new Date().toISOString(),
  };
}

async function compressEvidenceFolder(sourceDir, zipPath) {
  const script = "Compress-Archive -LiteralPath $env:SOURCE_DIR -DestinationPath $env:ZIP_PATH -Force";
  const result = await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    SOURCE_DIR: sourceDir,
    ZIP_PATH: zipPath,
  });
  if (result.code !== 0) {
    throw new Error(`Failed to export evidence package: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
}

function runProcess(command, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: dataRoot,
      shell: false,
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: error?.message ?? String(error) });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function syncReviewToFeishu(gameId) {
  const gameDir = path.join(dataRoot, "evidence", gameId);
  const missingInputs = [];
  for (const fileName of ["report.zh.json", "ai_eval.zh.json", "ai_eval.en.json"]) {
    if (!(await fileExists(path.join(gameDir, fileName)))) missingInputs.push(fileName);
  }
  if (missingInputs.length) {
    return {
      status: "skipped",
      reason: "missing_evaluation_files",
      missing_inputs: missingInputs,
      synced_at: new Date().toISOString(),
    };
  }

  const feishu = await readJsonOrNull(feishuPath);
  if (!feishu?.app_id || !feishu?.app_secret || !feishu?.bitable?.app_token || !feishu?.bitable?.tables?.evaluation_results?.table_id) {
    return {
      status: "skipped",
      reason: "feishu_not_configured",
      synced_at: new Date().toISOString(),
    };
  }

  try {
    await runAppTool("tools/build_feishu_payload_preview.mjs", "--game-id", gameId);
    await runAppTool("tools/check_feishu_table_fields.mjs");

    let fieldsReport = await readJsonOrNull(path.join(dataRoot, "config", "feishu_table_fields_check.json"));
    let createdFields = 0;
    if (fieldsReport?.status === "missing_fields") {
      await runAppTool("tools/create_feishu_fields.mjs", "--apply");
      const createReport = await readJsonOrNull(path.join(dataRoot, "config", "feishu_field_create_report.json"));
      createdFields = createReport?.created_fields?.length ?? 0;
      await runAppTool("tools/check_feishu_table_fields.mjs");
      fieldsReport = await readJsonOrNull(path.join(dataRoot, "config", "feishu_table_fields_check.json"));
    }

    if (fieldsReport?.status !== "ready_for_write_test") {
      return {
        status: fieldsReport?.status ?? "failed",
        reason: "fields_not_ready",
        missing_fields: (fieldsReport?.missing_fields ?? []).map((field) => field.field_name).filter(Boolean),
        created_fields: createdFields,
        synced_at: new Date().toISOString(),
      };
    }

    await runAppTool("tools/write_feishu_record.mjs", "--game-id", gameId, "--apply");
    const writeReport = await readJsonOrNull(path.join(gameDir, "feishu_write_result.json"));
    return {
      status: writeReport?.status ?? "unknown",
      action: writeReport?.action ?? "",
      record_id: writeReport?.record_id ?? "",
      record_url: writeReport?.record_url ?? "",
      created_fields: createdFields,
      synced_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error?.message ?? String(error),
      synced_at: new Date().toISOString(),
    };
  }
}

async function readBatchHistory() {
  const runsDir = path.join(dataRoot, "batch", "runs");
  let entries = [];
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const run = await readJsonOrNull(path.join(runsDir, entry.name, "run.json"));
      const summary = summarizeBatchRun(run);
      if (!summary) return null;
      return {
        ...summary,
        id: entry.name,
        archive_dir: summary.archive_dir || path.relative(dataRoot, path.join(runsDir, entry.name)).replaceAll("\\", "/"),
      };
    }));

  return runs
    .filter(Boolean)
    .sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")))
    .slice(0, 20);
}

function summarizeBatchRun(run) {
  if (!run) return null;
  const tasks = Array.isArray(run.tasks) ? run.tasks : [];
  const selectedGameIds = Array.isArray(run.selected_game_ids) ? run.selected_game_ids : [];
  const failedGameIds = tasks
    .filter((task) => task.status === "failed")
    .map((task) => task.game_id)
    .filter(Boolean);
  const retryGameIds = tasks
    .filter((task) => ["failed", "skipped_duplicate"].includes(task.status))
    .map((task) => task.game_id)
    .filter(Boolean);
  const completedIds = new Set(tasks
    .filter((task) => ["success", "skipped_duplicate"].includes(task.status))
    .map((task) => task.game_id)
    .filter(Boolean));
  const resumeGameIds = run.mode === "execute"
    ? (selectedGameIds.length
      ? selectedGameIds.filter((gameId) => gameId && !completedIds.has(gameId))
      : tasks
        .filter((task) => task.game_id && !completedIds.has(task.game_id))
        .map((task) => task.game_id)
        .filter(Boolean))
    : [];
  return {
    status: run.status ?? "",
    mode: run.mode ?? "",
    profile_name: run.profile_name ?? "",
    started_at: run.started_at ?? "",
    finished_at: run.finished_at ?? "",
    duration_ms: durationMs(run.started_at, run.finished_at),
    archive_dir: run.archive_dir ?? "",
    selected_game_ids: selectedGameIds,
    failed_game_ids: failedGameIds,
    retry_game_ids: retryGameIds,
    resume_game_ids: [...new Set(resumeGameIds)],
    options: {
      task_retries: run.options?.task_retries ?? 0,
      command_timeout_ms: run.options?.command_timeout_ms ?? 0,
      continue_on_error: Boolean(run.options?.continue_on_error),
      write_feishu: Boolean(run.options?.write_feishu),
    },
    totals: run.totals ?? {},
    tasks: tasks.map((task) => ({
      game_id: task.game_id,
      game_name: task.game_name,
      status: task.status,
      index: task.index,
      total: task.total,
      exit_code: task.exit_code,
      elapsed_ms: task.elapsed_ms,
      attempts: (task.attempts ?? []).map((attempt) => ({
        attempt: attempt.attempt,
        status: attempt.status,
        exit_code: attempt.exit_code,
        elapsed_ms: attempt.elapsed_ms,
        stdout_log: attempt.stdout_log ?? "",
        stderr_log: attempt.stderr_log ?? "",
      })),
      started_at: task.started_at,
      finished_at: task.finished_at,
      stderr_tail: task.stderr_tail ?? "",
      stdout_tail: task.stdout_tail ?? "",
    })),
  };
}

function buildBatchProductionOverview({ history = [], latestRun = null, latestDryRun = null, samples = [] } = {}) {
  const runs = Array.isArray(history) ? history : [];
  const executeRuns = runs.filter((run) => run.mode === "execute");
  const dryRunCount = runs.filter((run) => run.mode === "dry_run").length;
  const recentExecuteRuns = executeRuns.slice(0, 10);
  const tasks = recentExecuteRuns.flatMap((run) => (run.tasks ?? []).map((task) => ({ ...task, run })));
  const taskTotals = tasks.reduce((totals, task) => {
    const status = String(task.status ?? "");
    if (status === "success") totals.success += 1;
    if (status === "failed") totals.failed += 1;
    if (status === "skipped" || status === "skipped_duplicate") totals.skipped += 1;
    totals.queued += 1;
    totals.retry_attempts += Math.max(0, (task.attempts?.length ?? 0) - 1);
    if (status === "success" && (task.attempts?.length ?? 0) > 1) totals.recovered_by_retry += 1;
    if (status === "failed" && (task.attempts?.length ?? 0) > 1) totals.failed_after_retry += 1;
    return totals;
  }, {
    queued: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    retry_attempts: 0,
    recovered_by_retry: 0,
    failed_after_retry: 0,
  });
  const completed = taskTotals.success + taskTotals.failed;
  const successRate = completed ? Math.round((taskTotals.success / completed) * 100) : 0;
  const recoveryPlan = buildBatchRecoveryPlan(latestRun ?? executeRuns[0] ?? null);
  const recurrentFailures = buildRecurrentBatchFailures(tasks);
  const gameHistory = buildBatchGameHistory({ tasks, samples });
  const averageDurationMs = average(recentExecuteRuns.map((run) => Number(run.duration_ms ?? 0)).filter((value) => value > 0));
  const latestExecuteRun = latestRun?.mode === "execute" ? latestRun : executeRuns[0] ?? null;
  const status = recoveryPlan.game_ids.length
    ? "needs_recovery"
    : recurrentFailures.length
      ? "watch"
      : executeRuns.length
        ? "ready"
        : "empty";
  const tone = status === "needs_recovery" ? "warn" : status === "watch" ? "bad" : status === "ready" ? "good" : "warn";
  const note = status === "needs_recovery"
    ? `建议优先恢复 ${recoveryPlan.game_ids.length} 款未完成或失败游戏。`
    : status === "watch"
      ? `最近 ${recentExecuteRuns.length} 个执行批次里有重复失败游戏，建议先看错误尾巴。`
      : status === "ready"
        ? "最近批量记录可用于继续生产。"
        : "暂无执行历史，先预演队列再开始批量运行。";

  return {
    generated_at: new Date().toISOString(),
    status,
    tone,
    note,
    run_count: runs.length,
    execute_run_count: executeRuns.length,
    dry_run_count: dryRunCount,
    recent_window_count: recentExecuteRuns.length,
    latest_execute_run_id: latestExecuteRun?.id ?? "",
    latest_execute_status: latestExecuteRun?.status ?? "",
    latest_execute_started_at: latestExecuteRun?.started_at ?? "",
    latest_execute_finished_at: latestExecuteRun?.finished_at ?? "",
    latest_dry_run_status: latestDryRun?.status ?? "",
    average_duration_ms: Math.round(averageDurationMs),
    success_rate: successRate,
    totals: taskTotals,
    recovery_plan: recoveryPlan,
    recurrent_failures: recurrentFailures.slice(0, 8),
    game_history: gameHistory.slice(0, 80),
  };
}

function buildBatchRecoveryPlan(run) {
  const resumeIds = [...new Set((run?.resume_game_ids ?? []).filter(Boolean))];
  const retryIds = [...new Set((run?.retry_game_ids ?? []).filter(Boolean))];
  const gameIds = resumeIds.length ? resumeIds : retryIds;
  const scope = resumeIds.length ? "resume" : retryIds.length ? "failed" : "none";
  const label = scope === "resume" ? "填未完成项" : scope === "failed" ? "填失败项" : "无需恢复";
  return {
    scope,
    label,
    game_ids: gameIds,
    source_run_id: run?.id ?? "",
    source_archive_dir: run?.archive_dir ?? "",
    source_status: run?.status ?? "",
    source_started_at: run?.started_at ?? "",
  };
}

function buildRecurrentBatchFailures(tasks) {
  const failures = new Map();
  for (const task of tasks) {
    if (task.status !== "failed" || !task.game_id) continue;
    const existing = failures.get(task.game_id) ?? {
      game_id: task.game_id,
      game_name: task.game_name ?? "",
      fail_count: 0,
      retry_attempts: 0,
      profiles: new Set(),
      latest_failed_at: "",
      latest_error: "",
      latest_run_id: "",
    };
    existing.fail_count += 1;
    existing.retry_attempts += Math.max(0, (task.attempts?.length ?? 0) - 1);
    if (task.run?.profile_name) existing.profiles.add(task.run.profile_name);
    const failedAt = task.finished_at || task.run?.finished_at || task.run?.started_at || "";
    if (!existing.latest_failed_at || failedAt > existing.latest_failed_at) {
      existing.latest_failed_at = failedAt;
      existing.latest_error = summarizeTail(task.stderr_tail || task.stdout_tail);
      existing.latest_run_id = task.run?.id ?? "";
    }
    failures.set(task.game_id, existing);
  }
  return [...failures.values()]
    .filter((item) => item.fail_count > 1 || item.retry_attempts > 0)
    .sort((a, b) => b.fail_count - a.fail_count || String(b.latest_failed_at).localeCompare(String(a.latest_failed_at)))
    .map((item) => ({
      ...item,
      profiles: [...item.profiles],
    }));
}

function buildBatchGameHistory({ tasks = [], samples = [] } = {}) {
  const sampleNames = new Map(samples.map((sample) => [sample.game_id, sample.game_name]));
  const byGame = new Map();
  for (const task of tasks) {
    if (!task.game_id) continue;
    const existing = byGame.get(task.game_id) ?? {
      game_id: task.game_id,
      game_name: task.game_name || sampleNames.get(task.game_id) || "",
      run_count: 0,
      success_count: 0,
      failed_count: 0,
      skipped_count: 0,
      retry_attempts: 0,
      last_status: "",
      last_profile_name: "",
      last_run_id: "",
      last_started_at: "",
      last_finished_at: "",
      last_error: "",
    };
    existing.run_count += 1;
    if (task.status === "success") existing.success_count += 1;
    if (task.status === "failed") existing.failed_count += 1;
    if (["skipped", "skipped_duplicate"].includes(task.status)) existing.skipped_count += 1;
    existing.retry_attempts += Math.max(0, (task.attempts?.length ?? 0) - 1);
    const taskTime = task.finished_at || task.started_at || task.run?.finished_at || task.run?.started_at || "";
    if (!existing.last_started_at || taskTime > (existing.last_finished_at || existing.last_started_at)) {
      existing.last_status = task.status ?? "";
      existing.last_profile_name = task.run?.profile_name ?? "";
      existing.last_run_id = task.run?.id ?? "";
      existing.last_started_at = task.started_at || task.run?.started_at || "";
      existing.last_finished_at = task.finished_at || task.run?.finished_at || "";
      existing.last_error = task.status === "failed" ? summarizeTail(task.stderr_tail || task.stdout_tail) : "";
    }
    byGame.set(task.game_id, existing);
  }
  return [...byGame.values()].sort((a, b) => {
    const aTime = a.last_finished_at || a.last_started_at || "";
    const bTime = b.last_finished_at || b.last_started_at || "";
    return String(bTime).localeCompare(String(aTime));
  });
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function createBatchReport(body) {
  const { run, source } = await resolveBatchRunForReport(body);
  const summary = summarizeBatchRun(run);
  if (!summary) throw new Error("Batch run not found.");
  const reportId = safeReportName([
    summary.started_at || new Date().toISOString(),
    summary.mode || "batch",
    summary.profile_name || "profile",
  ].join("-"));
  const reportsDir = path.join(dataRoot, "batch", "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, `${reportId}.json`);
  const htmlPath = path.join(reportsDir, `${reportId}.html`);
  const report = {
    generated_at: new Date().toISOString(),
    source,
    summary,
  };
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(htmlPath, renderBatchReportHtml(report), "utf8");
  return {
    status: "generated",
    report_path: path.relative(dataRoot, htmlPath).replaceAll("\\", "/"),
    report_href: `/batch/reports/${encodeURIComponent(`${reportId}.html`)}`,
    json_path: path.relative(dataRoot, jsonPath).replaceAll("\\", "/"),
    json_href: `/batch/reports/${encodeURIComponent(`${reportId}.json`)}`,
  };
}

async function resolveBatchRunForReport(body) {
  const source = String(body.source ?? "").trim();
  if (source === "last_run") {
    return {
      source,
      run: await readJsonOrNull(path.join(dataRoot, "batch", "last_run.json")),
    };
  }
  if (source === "dry_run") {
    return {
      source,
      run: await readJsonOrNull(path.join(dataRoot, "batch", "dry_run.json")),
    };
  }
  const archiveDir = String(body.archiveDir ?? body.archive_dir ?? "").trim();
  if (!archiveDir) throw new Error("Missing batch report source.");
  const archivePath = resolveSafeDataPath(archiveDir, path.join(dataRoot, "batch"));
  return {
    source: archiveDir.replaceAll("\\", "/"),
    run: await readJsonOrNull(path.join(archivePath, "run.json")),
  };
}

function renderBatchReportHtml(report) {
  const summary = report.summary;
  const totals = summary.totals ?? {};
  const tasks = summary.tasks ?? [];
  const rows = tasks.map((task) => {
    const attempts = task.attempts ?? [];
    const latest = attempts[attempts.length - 1] ?? {};
    const logs = [
      latest.stdout_log ? `<a href="${escapeHtmlAttr(dataHref(latest.stdout_log))}">stdout</a>` : "",
      latest.stderr_log ? `<a href="${escapeHtmlAttr(dataHref(latest.stderr_log))}">stderr</a>` : "",
    ].filter(Boolean).join(" ");
    return `<tr>
      <td><strong>${escapeHtmlText(task.game_id ?? "-")}</strong><small>${escapeHtmlText(task.game_name ?? "")}</small></td>
      <td><span class="pill ${escapeHtmlAttr(statusTone(task.status))}">${escapeHtmlText(displayStatus(task.status))}</span></td>
      <td>${escapeHtmlText(formatMs(task.elapsed_ms))}</td>
      <td>${escapeHtmlText(task.exit_code ?? "-")}</td>
      <td>${escapeHtmlText(String(attempts.length || 0))}</td>
      <td>${logs || "-"}</td>
      <td>${escapeHtmlText(summarizeTail(task.stderr_tail || task.stdout_tail))}</td>
    </tr>`;
  }).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>批次报告 ${escapeHtmlText(summary.profile_name || "")}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f4f1ea; color: #27251f; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1180px; margin: 0 auto; background: #fffdf8; border: 1px solid #d8d2c5; border-radius: 16px; overflow: hidden; }
    header { padding: 28px 30px; border-bottom: 1px solid #d8d2c5; display: grid; gap: 10px; }
    h1 { margin: 0; font-size: 42px; line-height: .95; letter-spacing: -0.04em; }
    p { margin: 0; color: #6c665c; font-size: 14px; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; padding: 18px 30px; background: #efebe2; border-bottom: 1px solid #d8d2c5; }
    .metric { min-height: 72px; border: 1px solid #d8d2c5; border-radius: 12px; background: #fffdf8; padding: 12px; display: grid; align-content: space-between; }
    .metric span { color: #6c665c; font-size: 11px; font-weight: 800; letter-spacing: .04em; }
    .metric b { font-size: 24px; line-height: 1; }
    section { padding: 22px 30px 30px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #d8d2c5; border-radius: 12px; overflow: hidden; }
    th, td { border-bottom: 1px solid #d8d2c5; padding: 11px 12px; text-align: left; vertical-align: top; font-size: 13px; }
    th { background: #efebe2; color: #6c665c; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
    td small { display: block; margin-top: 4px; color: #6c665c; overflow-wrap: anywhere; }
    td:last-child { overflow-wrap: anywhere; }
    a { color: #27251f; font-weight: 800; text-decoration: underline; text-underline-offset: 3px; }
    .pill { display: inline-flex; min-height: 24px; align-items: center; border-radius: 999px; border: 1px solid #d8d2c5; padding: 0 9px; font-size: 12px; font-weight: 800; }
    .good { background: #dff0df; border-color: #9fc9a2; }
    .warn { background: #f5ead4; border-color: #d7b46e; }
    .bad { background: #f7dbe3; border-color: #dfa0b2; }
  </style>
</head>
<body>
  <main>
    <header>
      <p>H5 游戏评测助手 · 批次报告</p>
      <h1>${escapeHtmlText(batchModeLabel(summary.mode))} · ${escapeHtmlText(displayStatus(summary.status))}</h1>
      <p>${escapeHtmlText(summary.profile_name || "-")} · ${escapeHtmlText(formatDateTime(summary.started_at))} · 来源 ${escapeHtmlText(report.source || "-")}</p>
    </header>
    <div class="metrics">
      <div class="metric"><span>计划</span><b>${escapeHtmlText(totals.queued ?? tasks.length)}</b></div>
      <div class="metric good"><span>成功</span><b>${escapeHtmlText(totals.success ?? 0)}</b></div>
      <div class="metric bad"><span>失败</span><b>${escapeHtmlText(totals.failed ?? 0)}</b></div>
      <div class="metric"><span>跳过</span><b>${escapeHtmlText(totals.skipped ?? 0)}</b></div>
      <div class="metric"><span>耗时</span><b>${escapeHtmlText(formatMs(summary.duration_ms))}</b></div>
    </div>
    <section>
      <table>
        <thead><tr><th>游戏</th><th>状态</th><th>耗时</th><th>Exit</th><th>尝试</th><th>日志</th><th>失败尾巴</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7">暂无任务明细</td></tr>`}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function resolveSafeDataPath(relativePath, allowedRoot) {
  const clean = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Invalid path.");
  const resolved = path.resolve(dataRoot, clean);
  const allowed = path.resolve(allowedRoot);
  if (resolved !== allowed && !resolved.startsWith(`${allowed}${path.sep}`)) {
    throw new Error("Path is outside the allowed batch directory.");
  }
  return resolved;
}

function dataHref(relativePath) {
  const clean = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  return `/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

function safeReportName(value) {
  return String(value ?? "batch-report")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "batch-report";
}

function escapeHtmlText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(value) {
  return escapeHtmlText(value);
}

function displayStatus(value) {
  const labels = {
    planned: "已计划",
    pending: "待执行",
    running: "运行中",
    cancelling: "取消中",
    cancelled: "已取消",
    failed: "失败",
    success: "成功",
    success_with_failures: "部分成功",
    skipped_duplicate: "重复跳过",
    dry_run_ready: "预演就绪",
  };
  const key = String(value ?? "");
  return labels[key] ?? (value || "-");
}

function batchModeLabel(value) {
  const labels = {
    batch: "批量",
    dry_run: "预演",
    execute: "执行",
  };
  return labels[String(value ?? "")] ?? (value || "-");
}

function statusTone(value) {
  if (["success", "ready_for_write_test", "updated", "written"].includes(value)) return "good";
  if (["success_with_failures", "success_with_review", "dry_run_ready", "taxonomy_review_required", "template_ready", "cancelling", "cancelled", "planned", "pending"].includes(value)) return "warn";
  if (!value || value === "missing" || value === "failed" || value === "invalid") return "bad";
  return "";
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatMs(ms) {
  const value = Number(ms ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function summarizeTail(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-2).join(" ");
}

function durationMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt ?? "");
  const finish = Date.parse(finishedAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return 0;
  return finish - start;
}

async function saveConfig(body) {
  const env = await readEnv();
  if (body.ai) {
    const ai = body.ai;
    const providers = ai.providers ?? {};
    if (ai.activeProvider) env.AI_PROVIDER = ai.activeProvider;
    if (providers.gemini?.apiKey) env.GEMINI_API_KEY = providers.gemini.apiKey;
    if (providers.gemini?.model) env.GEMINI_MODEL = providers.gemini.model;
    env.GEMINI_PROXY = providers.gemini?.proxy ?? env.GEMINI_PROXY ?? "";
    if (providers.openai_compatible?.apiKey) env.OPENAI_API_KEY = providers.openai_compatible.apiKey;
    if (providers.openai_compatible?.baseUrl) env.OPENAI_BASE_URL = providers.openai_compatible.baseUrl;
    if (providers.openai_compatible?.model) env.OPENAI_MODEL = providers.openai_compatible.model;
    if (providers.deepseek?.apiKey) env.DEEPSEEK_API_KEY = providers.deepseek.apiKey;
    if (providers.deepseek?.baseUrl) env.DEEPSEEK_BASE_URL = providers.deepseek.baseUrl;
    if (providers.deepseek?.model) env.DEEPSEEK_MODEL = providers.deepseek.model;
    if (providers.openrouter?.apiKey) env.OPENROUTER_API_KEY = providers.openrouter.apiKey;
    if (providers.openrouter?.baseUrl) env.OPENROUTER_BASE_URL = providers.openrouter.baseUrl;
    if (providers.openrouter?.model) env.OPENROUTER_MODEL = providers.openrouter.model;
    env.ENABLE_AI_EVALUATION = env.ENABLE_AI_EVALUATION ?? "true";
    env.ENABLE_AI_ACTION = env.ENABLE_AI_ACTION ?? "false";
  }
  if (body.gemini) {
    if (body.gemini.apiKey) env.GEMINI_API_KEY = body.gemini.apiKey;
    if (body.gemini.model) env.GEMINI_MODEL = body.gemini.model;
    env.GEMINI_PROXY = body.gemini.proxy ?? env.GEMINI_PROXY ?? "";
    env.AI_PROVIDER = env.AI_PROVIDER ?? "gemini";
    env.ENABLE_AI_EVALUATION = env.ENABLE_AI_EVALUATION ?? "true";
    env.ENABLE_AI_ACTION = env.ENABLE_AI_ACTION ?? "false";
  }
  await writeEnv(env);

  if (body.feishu) {
    const feishu = (await readJsonOrNull(feishuPath)) ?? (await readJsonOrNull(feishuTemplatePath)) ?? {};
    feishu.enabled = true;
    if (body.feishu.appId) feishu.app_id = body.feishu.appId;
    if (body.feishu.appSecret) feishu.app_secret = body.feishu.appSecret;
    feishu.bitable ??= {};
    feishu.bitable.tables ??= {};
    feishu.bitable.tables.evaluation_results ??= {};
    const parsed = parseBitableUrl(body.feishu.bitableUrl ?? "");
    if (body.feishu.appToken) feishu.bitable.app_token = body.feishu.appToken;
    if (parsed.appToken) feishu.bitable.app_token = parsed.appToken;
    feishu.bitable.upload_screenshots = Boolean(body.feishu.uploadScreenshots);
    if (body.feishu.tableId) feishu.bitable.tables.evaluation_results.table_id = body.feishu.tableId;
    if (parsed.tableId) feishu.bitable.tables.evaluation_results.table_id = parsed.tableId;
    if (parsed.viewId) feishu.bitable.tables.evaluation_results.view_id = parsed.viewId;
    if (parsed.wikiNodeToken) feishu.bitable.wiki_node_token = parsed.wikiNodeToken;
    feishu.bitable.tables.evaluation_results.field_mapping_file ??= "mock_bitable/feishu_field_mapping.csv";
    await fs.mkdir(path.dirname(feishuPath), { recursive: true });
    await fs.writeFile(feishuPath, `${JSON.stringify(feishu, null, 2)}\n`, "utf8");
  }
}

function startJob(action, options) {
  const spec = buildJobSpec(action, options);
  const id = crypto.randomUUID();
  const job = {
    id,
    action,
    name: spec.name,
    command: spec.command,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: "",
    output: "",
    code: null,
    needsRefresh: false,
  };
  jobs.set(id, job);
  const { executable, args } = spawnSpec(spec.command);
  const child = spawn(executable, args, { cwd: dataRoot, shell: false, env: childProcessEnv() });
  job.child = child;
  child.stdout.on("data", (chunk) => appendJob(job, chunk));
  child.stderr.on("data", (chunk) => appendJob(job, chunk));
  child.on("close", async (code) => {
    job.code = code;
    job.status = job.cancelRequested ? "cancelled" : code === 0 ? "success" : "failed";
    job.finished_at = new Date().toISOString();
    if (job.cancelRequested && job.action === "run-batch") {
      await markLatestBatchCancelled();
    }
    job.needsRefresh = true;
    job.child = null;
  });
  child.on("error", (error) => {
    appendJob(job, `${error.message}\n`);
    job.status = "failed";
    job.finished_at = new Date().toISOString();
    job.needsRefresh = true;
  });
  return job;
}

function buildJobSpec(action, options) {
  if (action === "gemini-test") return { name: "测试 Gemini", command: nodeScript("tools/test_gemini_connection.mjs") };
  if (action === "feishu-check") return { name: "检查飞书配置", command: nodeScript("tools/check_feishu_config.mjs") };
  if (action === "feishu-fields") return { name: "检查飞书字段", command: nodeScript("tools/check_feishu_table_fields.mjs") };
  if (action === "taxonomy-sync") return { name: "同步标签库", command: nodeScript("tools/sync_taxonomy_from_feishu.mjs") };
  if (action === "batch-plan") return { name: "刷新批量计划", command: nodeScript("tools/build_batch_manifest.mjs") };
  if (action === "run-batch") {
    const command = nodeScript(
      "tools/run_batch_pipeline.mjs",
      "--profile",
      String(options.profileName ?? "poc_review"),
    );
    if (options.execute) command.push("--execute");
    if (Array.isArray(options.gameIds) && options.gameIds.length) command.push("--game-ids", options.gameIds.join(","));
    if (options.writeFeishu) command.push("--write-feishu");
    if (options.forceCollect) command.push("--force-collect");
    if (options.forceAi) command.push("--force-ai");
    if (options.continueOnError) command.push("--continue-on-error");
    if (options.allowDuplicates) command.push("--allow-duplicates");
    if (options.playStrategy) command.push("--play-strategy", String(options.playStrategy));
    if (options.failOnPartial || Number(options.playSeconds ?? 0) >= 1800) command.push("--fail-on-partial");
    return { name: `${options.execute ? "批量运行" : "批量预演"} ${options.profileName ?? ""}`.trim(), command };
  }
  if (action === "quick-check") return { name: "快速检查", command: nodeScript("tools/run_quick_checks.mjs") };
  if (action === "run-game") {
    const command = nodeScript(
      "tools/run_game_pipeline.mjs",
      "--game-id",
      String(options.gameId),
      "--play-seconds",
      String(options.playSeconds ?? 60),
      "--ai",
      options.aiMode === "live" ? "live" : "local",
      "--trace",
      String(options.trace ?? "off"),
      "--ai-eval-mode",
      String(options.aiEvalMode ?? "low"),
      "--max-images",
      String(options.maxImages ?? 2),
    );
    if (options.playStrategy) command.push("--play-strategy", String(options.playStrategy));
    if (options.recordVideo && Number(options.videoSeconds ?? 0) > 0) {
      command.push("--record-video", "--video-seconds", String(options.videoSeconds));
    }
    if (options.writeFeishu) command.push("--write-feishu");
    if (options.forceCollect) command.push("--force-collect");
    if (options.forceAi) command.push("--force-ai");
    if (options.failOnPartial || Number(options.playSeconds ?? 0) >= 1800) command.push("--fail-on-partial");
    return { name: `运行 ${options.gameId}`, command };
  }
  throw new Error(`Unknown job action: ${action}`);
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (!["running", "cancelling"].includes(job.status)) return job;
  job.cancelRequested = true;
  job.status = "cancelling";
  job.needsRefresh = true;
  appendJob(job, "\n[cancel] 用户请求取消当前任务。\n");
  killProcessTree(job.child);
  return job;
}

function killProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      return;
    }
    child.kill("SIGTERM");
  } catch {
    try {
      child.kill();
    } catch {
      // Process already exited.
    }
  }
}

async function markLatestBatchCancelled() {
  const latestPath = path.join(dataRoot, "batch", "last_run.json");
  const run = await readJsonOrNull(latestPath);
  if (!run || run.mode !== "execute" || !["running", "cancelling"].includes(run.status)) return;
  run.status = "cancelled";
  run.finished_at = run.finished_at || new Date().toISOString();
  if (run.totals) run.totals.running = 0;
  if (Array.isArray(run.tasks)) {
    for (const task of run.tasks) {
      if (["running", "cancelling"].includes(task.status)) {
        task.status = "cancelled";
        task.finished_at = task.finished_at || run.finished_at;
      }
    }
  }
  await fs.writeFile(latestPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  if (run.archive_dir) {
    const archivePath = path.join(dataRoot, run.archive_dir, "run.json");
    await fs.writeFile(archivePath, `${JSON.stringify(run, null, 2)}\n`, "utf8").catch(() => {});
  }
}

function appendJob(job, chunk) {
  job.output += chunk.toString();
  if (job.output.length > 20000) job.output = job.output.slice(-20000);
}

function listJobs() {
  return [...jobs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at)).map(serializeJob);
}

function serializeJob(job) {
  return {
    id: job.id,
    action: job.action,
    name: job.name,
    command: job.command.join(" "),
    status: job.status,
    started_at: job.started_at,
    finished_at: job.finished_at,
    output: job.output,
    code: job.code,
    needsRefresh: job.needsRefresh,
  };
}

async function importGames(urls) {
  const samples = await readSamples();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const rawUrl of urls) {
    const parsed = parseGameUrl(rawUrl);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    const existing = samples.find((item) => item.game_id === parsed.game_id || item.url === parsed.url);
    if (existing) {
      existing.url = parsed.url;
      existing.game_name = existing.game_name || parsed.game_name;
      existing.status = existing.status || "imported";
      updated += 1;
    } else {
      samples.push({ ...parsed, status: "imported", notes: "Imported from app UI" });
      added += 1;
    }
  }

  await writeSamples(samples);
  return { added, updated, skipped };
}

function parseGameUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const slug = url.pathname.match(/\/game\/([^/]+)/i)?.[1] ?? path.basename(url.pathname);
    const gameId = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!gameId) return null;
    return {
      game_id: gameId,
      game_name: titleCase(gameId),
      url: url.toString(),
    };
  } catch {
    return null;
  }
}

function parseBitableUrl(rawUrl) {
  if (!rawUrl) return {};
  try {
    const url = new URL(rawUrl);
    const tableId = url.searchParams.get("table") ?? "";
    const viewId = url.searchParams.get("view") ?? "";
    const baseMatch = url.pathname.match(/\/base\/([^/?]+)/i);
    const wikiMatch = url.pathname.match(/\/wiki\/([^/?]+)/i);
    return {
      appToken: baseMatch?.[1] ?? "",
      wikiNodeToken: wikiMatch?.[1] ?? "",
      tableId,
      viewId,
    };
  } catch {
    return {};
  }
}

async function readSamples() {
  const text = await fs.readFile(samplesPath, "utf8");
  return parseCsv(text);
}

async function readCsvOrEmpty(filePath) {
  const text = await readTextOrNull(filePath);
  return text ? parseCsv(text) : [];
}

function resolveDataFile(filePath) {
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  return path.join(dataRoot, filePath);
}

function countBy(items, key) {
  return items.reduce((totals, item) => {
    const value = item[key] || "unknown";
    totals[value] = (totals[value] ?? 0) + 1;
    return totals;
  }, {});
}

async function writeSamples(rows) {
  const header = "game_id,game_name,url,status,notes";
  const lines = rows.map((row) => [row.game_id, row.game_name, row.url, row.status, row.notes].map(csvCell).join(","));
  await fs.writeFile(samplesPath, `${header}\n${lines.join("\n")}\n`, "utf8");
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() ?? "");
  return lines.filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function titleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function readEnv() {
  const text = (await readTextOrNull(envPath)) ?? (await readTextOrNull(envExamplePath)) ?? "";
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return values;
}

async function writeEnv(values) {
  const order = [
    "AI_PROVIDER",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GEMINI_TIMEOUT_MS",
    "GEMINI_PROXY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_MODEL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "OPENROUTER_MODEL",
    "ENABLE_AI_EVALUATION",
    "ENABLE_AI_ACTION",
  ];
  const lines = order.map((key) => `${key}=${values[key] ?? ""}`);
  await fs.writeFile(envPath, `${lines.join("\n")}\n`, "utf8");
}

async function handleStatic(response, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  let filePath;
  if (decoded === "/favicon.ico") {
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (decoded === "/" || decoded === "/index.html") {
    filePath = path.join(appDir, "index.html");
  } else if (decoded.startsWith("/app/")) {
    filePath = path.join(appRoot, decoded.slice(1));
  } else if (decoded.startsWith("/docs/")) {
    filePath = path.join(appRoot, decoded.slice(1));
  } else if (decoded.startsWith("/evidence/") || decoded.startsWith("/workbench/") || decoded.startsWith("/outputs/") || decoded.startsWith("/batch/")) {
    filePath = path.join(dataRoot, decoded.slice(1));
  } else {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const resolved = path.resolve(filePath);
  const allowedRoots = [
    appDir,
    path.join(appRoot, "docs"),
    path.join(dataRoot, "evidence"),
    path.join(dataRoot, "workbench"),
    path.join(dataRoot, "outputs"),
    path.join(dataRoot, "batch"),
  ].map((item) => path.resolve(item));
  if (!allowedRoots.some((allowed) => resolved === allowed || resolved.startsWith(`${allowed}${path.sep}`))) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await fs.readFile(resolved);
    response.writeHead(200, {
      "Content-Type": mimeType(resolved),
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function spawnSpec(commandParts) {
  const [command, ...args] = commandParts;
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", commandParts.map(quoteWindowsArg).join(" ")],
    };
  }
  return { executable: command, args };
}

function runAppTool(scriptPath, ...args) {
  return new Promise((resolve, reject) => {
    const commandParts = nodeScript(scriptPath, ...args);
    const { executable, args: commandArgs } = spawnSpec(commandParts);
    const child = spawn(executable, commandArgs, { cwd: dataRoot, shell: false, env: childProcessEnv() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Tool timed out: ${path.basename(scriptPath)}`));
    }, 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 12000) stdout = stdout.slice(-12000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`Tool failed: ${path.basename(scriptPath)} exit=${code}. ${stderr || stdout}`.trim()));
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function nodeScript(scriptPath, ...args) {
  return [process.env.H5_NODE_EXECUTABLE || process.execPath, path.join(appRoot, scriptPath), ...args];
}

function childProcessEnv() {
  const env = { ...process.env };
  env.H5_APP_ROOT = appRoot;
  env.H5_DATA_ROOT = dataRoot;
  if (env.H5_ELECTRON_RUN_AS_NODE === "1") env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

function openFolder(folderPath) {
  if (process.platform === "win32") {
    spawn("explorer.exe", [folderPath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [folderPath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [folderPath], { detached: true, stdio: "ignore" }).unref();
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readTextOrNull(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}
