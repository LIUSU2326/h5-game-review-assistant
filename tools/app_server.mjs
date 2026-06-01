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
  const games = await Promise.all(samples.map(readGameStatus));
  const fieldsCheck = await readJsonOrNull(path.join(dataRoot, "config", "feishu_table_fields_check.json"));
  const taxonomy = await readJsonOrNull(path.join(dataRoot, "config", "taxonomy_from_feishu.json"));
  const geminiCheck = await readJsonOrNull(path.join(dataRoot, "config", "gemini_connection_check.json"));
  const latestBatchRun = await readJsonOrNull(path.join(dataRoot, "batch", "last_run.json"));
  const latestBatchDryRun = await readJsonOrNull(path.join(dataRoot, "batch", "dry_run.json"));
  const batchHistory = await readBatchHistory();
  const ready = Boolean(
    env.GEMINI_API_KEY &&
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
      gemini: {
        api_key_configured: Boolean(env.GEMINI_API_KEY),
        model: env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
        proxy: env.GEMINI_PROXY ?? "",
        latest_check_status: geminiCheck?.status ?? "",
      },
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
    batch: {
      last_run: summarizeBatchRun(latestBatchRun),
      dry_run: summarizeBatchRun(latestBatchDryRun),
      history: batchHistory,
    },
    games,
    summary: {
      latest_note: ready ? "配置已就绪，可以运行单款或批量评测" : "请先补齐 Gemini 和飞书配置",
    },
  };
}

async function buildConfigWorkbench() {
  const feishu = (await readJsonOrNull(feishuPath)) ?? {};
  const fieldsCheck = await readJsonOrNull(path.join(dataRoot, "config", "feishu_table_fields_check.json"));
  const taxonomy = await readJsonOrNull(path.join(dataRoot, "config", "taxonomy_from_feishu.json"));
  const mappingFile =
    feishu?.bitable?.tables?.evaluation_results?.field_mapping_file ?? "mock_bitable/feishu_field_mapping.csv";
  const mappingPath = resolveDataFile(mappingFile);
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

  return {
    generated_at: new Date().toISOString(),
    mapping_file: path.relative(dataRoot, mappingPath).replaceAll("\\", "/"),
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
    rejected: merged.filter((item) => item.review_status === "rejected").length,
    needs_info: merged.filter((item) => item.review_status === "needs_info").length,
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
    const candidates = [
      ...normalizeEnTaxonomySuggestions(en?.result?.taxonomy_new_suggestions ?? []),
      ...normalizeZhTaxonomySuggestions(zh?.result ?? {}),
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
      is_actionable: !item.id,
      existing_option_id: item.id ?? "",
    }));
  });
}

function taxonomySuggestionId(item) {
  return crypto
    .createHash("sha1")
    .update([item.language, item.field, item.suggestion, item.reason].join("\n"))
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
  const category = taxonomyCategoryForField(item.field);
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
  const category = taxonomyCategoryForField(item.field);
  const sameSource = (candidate) => {
    if (candidate.id === item.id) return false;
    if (!candidate.is_actionable) return false;
    if (taxonomyCategoryForField(candidate.field) !== category) return false;
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
  const normalized = String(field ?? "").toLowerCase();
  if (["audience", "target_audience"].includes(normalized)) return "audiences";
  if (["game_type", "sub_type", "subgenre"].includes(normalized)) return "gameplay_types";
  if (normalized === "theme") return "themes";
  if (normalized === "art_style") return "art_styles";
  if (normalized === "feature_tags") return "feature_tags";
  if (normalized === "controls") return "controls";
  return "";
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

async function readGameStatus(sample) {
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
    feishu_write_status: writeFresh ? (write?.status ?? "") : (dryRun?.status ?? ""),
    feishu_write_stale: Boolean(write && !writeFresh),
    record_id: writeFresh ? (write?.record_id ?? "") : "",
    screenshot_upload_status: screenshotUpload?.status ?? "",
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
  if (["success_with_failures", "success_with_review", "dry_run_ready", "template_ready", "cancelling", "cancelled", "planned", "pending"].includes(value)) return "warn";
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
