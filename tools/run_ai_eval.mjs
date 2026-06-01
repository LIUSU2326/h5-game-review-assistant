import fs from "node:fs/promises";
import path from "node:path";
import { geminiFetch, proxyStatus } from "./lib/gemini_http.mjs";

const root = process.cwd();
const evidenceRoot = path.join(root, "evidence");
const mockDir = path.join(root, "mock_bitable");
const env = await loadEnv(path.join(root, ".env"));

const args = parseArgs(process.argv.slice(2));
const gameId = args.gameId ?? args["game-id"] ?? "cow-saver";
const mode = args.mode ?? "standard";
const model = args.model ?? env.GEMINI_MODEL ?? "gemini-2.5-flash";
const apiKey = env.GEMINI_API_KEY ?? "";
const localFallback = Boolean(args["local-fallback"]);
const dryRun = args["dry-run"] || (!apiKey && !localFallback);
const geminiTimeoutMs = Number(args.timeoutMs ?? args["timeout-ms"] ?? env.GEMINI_TIMEOUT_MS ?? 120000);

const imageLimitByMode = {
  low: 3,
  standard: 6,
  high: 12,
};
const maxImages = Number(args.maxImages ?? args["max-images"] ?? imageLimitByMode[mode] ?? imageLimitByMode.standard);

const gameDir = path.join(evidenceRoot, gameId);
const zhReportPath = path.join(gameDir, "report.zh.json");
const report = JSON.parse(await fs.readFile(zhReportPath, "utf8"));
const taxonomies = await loadTaxonomies();
const outputFields = await readCsv(path.join(mockDir, "output_fields.csv"));
const screenshots = await selectScreenshots(gameDir, maxImages, report);

const requestPreview = {
  game_id: gameId,
  model,
  mode,
  dry_run: Boolean(dryRun),
  proxy: proxyStatus(env),
  timeout_ms: geminiTimeoutMs,
  will_send_images: screenshots.map((item) => item.relativePath),
  image_count: screenshots.length,
  report_summary: compactReport(report),
  taxonomy_counts: Object.fromEntries(Object.entries(taxonomies).map(([key, rows]) => [key, rows.length])),
  prompt: buildPrompt({ report, taxonomies, outputFields }),
};

await fs.writeFile(
  path.join(gameDir, "ai_request_preview.json"),
  `${JSON.stringify(requestPreview, null, 2)}\n`,
  "utf8",
);

if (dryRun) {
  console.log(`AI request preview written to ${path.join(gameDir, "ai_request_preview.json")}`);
  console.log(apiKey ? "Dry run only. Remove --dry-run to run the live Gemini evaluation." : "No GEMINI_API_KEY found. Add it to .env to run the live Gemini evaluation.");
  process.exit(0);
}

if (localFallback) {
  const fallback = await buildLocalFallbackEvaluation({ gameId, gameDir, model, report, screenshots });
  await writeEvaluationFiles({ gameDir, gameId, model, screenshots, parsed: fallback, source: "local_fallback" });
  console.log(`Local fallback AI-style evaluation written to ${path.join(gameDir, "ai_eval.zh.json")}`);
  process.exit(0);
}

try {
  const aiResult = await callGemini({
    apiKey,
    model,
    env,
    timeoutMs: geminiTimeoutMs,
    prompt: requestPreview.prompt,
    screenshots,
  });

  const parsed = repairGeminiResult(parseJsonText(aiResult.text), report);
  await writeEvaluationFiles({
    gameDir,
    gameId,
    model,
    screenshots,
    parsed,
    source: "gemini",
    rawText: parsed.zh ? undefined : aiResult.text,
  });

  console.log(`AI evaluation written to ${path.join(gameDir, "ai_eval.zh.json")}`);
  console.log(`English export evaluation written to ${path.join(gameDir, "ai_eval.en.json")}`);
} catch (error) {
  const errorReport = {
    game_id: gameId,
    model,
    generated_at: new Date().toISOString(),
    status: "failed",
    error: {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
      code: error?.cause?.code,
    },
    proxy: proxyStatus(env),
    likely_causes: [
      "The local network cannot reach generativelanguage.googleapis.com.",
      "A proxy or VPN is required for this environment.",
      "The selected Gemini model is unavailable for this API key or region.",
      "The API key is missing required Gemini API access.",
    ],
    request_preview_file: "ai_request_preview.json",
  };
  await fs.writeFile(path.join(gameDir, "ai_eval_error.json"), `${JSON.stringify(errorReport, null, 2)}\n`, "utf8");
  console.error(`AI evaluation failed. Error report written to ${path.join(gameDir, "ai_eval_error.json")}`);
  process.exitCode = 1;
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

async function loadEnv(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function parseCsv(text) {
  const rows = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = rows.shift().split(",");
  return rows.filter(Boolean).map((row) => {
    const values = row.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function readCsv(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return parseCsv(text);
}

async function loadTaxonomies() {
  const feishuTaxonomies = await readFeishuTaxonomies();
  if (feishuTaxonomies) return feishuTaxonomies;

  const tables = {
    gameplay_types: "gameplay_types.csv",
    themes: "themes.csv",
    art_styles: "art_styles.csv",
    feature_tags: "feature_tags.csv",
    audiences: "audiences.csv",
    controls: "controls.csv",
  };

  const loaded = {};
  for (const [key, file] of Object.entries(tables)) {
    const rows = await readCsv(path.join(mockDir, file));
    loaded[key] = rows
      .filter((row) => row.enabled === "true")
      .map((row) => ({
        id: row.id,
        name_en: row.name_en,
        name_zh: row.name_zh,
        description_zh: row.description_zh,
        parent_id: row.parent_id,
        level: row.level,
      }));
  }
  return loaded;
}

async function readFeishuTaxonomies() {
  const syncedPath = path.join(root, "config", "taxonomy_from_feishu.json");
  try {
    const synced = JSON.parse(await fs.readFile(syncedPath, "utf8"));
    if (synced.status !== "synced" || !synced.categories) return null;
    return Object.fromEntries(
      Object.entries(synced.categories).map(([category, rows]) => [
        category,
        rows
          .filter((row) => row.enabled !== false)
          .map((row) => ({
            id: row.id,
            name_en: row.name_en,
            name_zh: row.name_zh,
            description_zh: row.description_zh,
            parent_id: row.parent_id,
            level: row.level,
          })),
      ]),
    );
  } catch {
    return null;
  }
}

async function selectScreenshots(gameDirPath, maxImages, reportData) {
  const screenshotDir = path.join(gameDirPath, "screenshots");
  const preferred = [
    "desktop-normal.png",
    "mobile-portrait-normal.png",
    "mobile-landscape-normal.png",
    "mobile-portrait-slow4g.png",
    "desktop-slow4g.png",
  ];
  const reportScreenshots = Array.isArray(reportData?.screenshots)
    ? reportData.screenshots.filter((item) => typeof item === "string" && item.endsWith(".png"))
    : [];
  const allFiles = await fs.readdir(screenshotDir);
  const reportItems = reportScreenshots.length
    ? reportScreenshots
    : allFiles.filter((file) => file.endsWith(".png")).map((file) => `screenshots/${file}`);
  const selectedItems = [
    ...preferred
      .map((file) => reportItems.find((item) => path.basename(item) === file))
      .filter(Boolean),
    ...reportItems
      .filter((item) => !preferred.includes(path.basename(item)))
      .sort((a, b) => a.localeCompare(b)),
  ].slice(0, maxImages);

  return Promise.all(
    selectedItems.map(async (relativeItem) => {
      const absolutePath = path.join(gameDirPath, relativeItem);
      const bytes = await fs.readFile(absolutePath);
      return {
        absolutePath,
        relativePath: path.relative(gameDirPath, absolutePath).replaceAll("\\", "/"),
        mimeType: "image/png",
        base64: bytes.toString("base64"),
      };
    }),
  );
}

function compactReport(source) {
  return {
    game_id: source.game_id,
    game_name: source.game_name,
    url: source.url,
    page_title: source.page_title,
    meta_description: source.meta_description,
    keywords: source.keywords,
    normal_network_load_ms: source.normal_network_load_ms,
    slow_4g_load_ms: source.slow_4g_load_ms,
    package_size_estimate_mb: source.package_size_estimate_mb,
    collection_quality: {
      status: source.collection_quality?.quality_status,
      warnings: source.collection_quality?.quality_warnings ?? [],
      screenshot_count: source.collection_quality?.screenshot_count,
      autoplay_action_count: source.collection_quality?.autoplay_action_count,
    },
    runs: (source.runs ?? []).map((run) => ({
      id: run.id,
      label: run.label,
      target_match: run.target_match,
      start_action: run.start_action,
      overlay_action: run.overlay_action,
      final_url: run.page?.final_url,
      canonical: run.page?.canonical,
      body_text_sample: run.page?.body_text_sample,
      errors: run.errors,
    })),
  };
}

function buildPrompt({ report: sourceReport, taxonomies: taxonomyData, outputFields: fields }) {
  return `
你是一个 H5 小游戏评测助手。请根据截图、页面信息和配置库，为游戏生成结构化评测。

重要规则：
1. 后台中文结果放在 "zh"，英文导出结果放在 "en"。
2. 玩法、题材、画风、特色标签、适合人群、操作方式必须优先从 taxonomy 中选择。
3. 如果现有 taxonomy 没有合适选项，不要强行选择。请写入 new_suggestions，并把 needs_taxonomy_review 设为 true。
4. 每个判断型字段都需要 confidence，范围 0-1。
5. 不要编造截图和报告里没有证据支持的内容。
6. 忽略广告、推广弹窗、外部落地页、Open/Install 按钮、Advertisement 文案、健康减肥广告、以及“Please rotate screen”遮罩；这些不是游戏本体，不要据此判断题材、玩法、目标人群或产品介绍。
7. 如果截图被广告遮挡，只能依据可见的游戏主体、页面标题、URL 和采集摘要做低置信度判断，并在 review_notes / taxonomy_new_suggestions 里说明遮挡风险。
8. 输出必须是合法 JSON，不要 Markdown，不要解释。

页面和采集摘要：
${JSON.stringify(compactReport(sourceReport), null, 2)}

输出字段定义：
${JSON.stringify(fields, null, 2)}

taxonomy 配置库：
${JSON.stringify(taxonomyData, null, 2)}

请输出这个 JSON 结构：
{
  "zh": {
    "device_fit": {"value": "...", "confidence": 0.0, "evidence": ["..."]},
    "audience": {"selected": [{"id": "...", "name_zh": "..."}], "new_suggestions": [], "needs_taxonomy_review": false, "confidence": 0.0},
    "game_mode": {"value": "...", "confidence": 0.0},
    "game_type": {"selected": [{"id": "...", "name_zh": "..."}], "new_suggestions": [], "needs_taxonomy_review": false, "confidence": 0.0},
    "sub_type": {"selected": [{"id": "...", "name_zh": "..."}], "new_suggestions": [], "needs_taxonomy_review": false, "confidence": 0.0},
    "theme": {"selected": [{"id": "...", "name_zh": "..."}], "new_suggestions": [], "needs_taxonomy_review": false, "confidence": 0.0},
    "art_style": {"selected": [{"id": "...", "name_zh": "..."}], "new_suggestions": [], "needs_taxonomy_review": false, "confidence": 0.0},
    "feature_tags": {"selected": [{"id": "...", "name_zh": "..."}], "new_suggestions": [], "needs_taxonomy_review": false, "confidence": 0.0},
    "orientation": {"value": "...", "confidence": 0.0},
    "tutorial": {"value": "...", "confidence": 0.0},
    "bgm": {"value": "unknown", "confidence": 0.0},
    "responsive": {"value": "...", "confidence": 0.0},
    "controls": {"selected": [{"id": "...", "name_zh": "..."}], "new_suggestions": [], "needs_taxonomy_review": false, "confidence": 0.0},
    "how_to_play": ["..."],
    "review_notes": ["..."]
  },
  "en": {
    "device_compatibility": "...",
    "target_audience": ["..."],
    "game_mode": "...",
    "game_type": "...",
    "subgenre": "...",
    "theme": ["..."],
    "art_style": "...",
    "feature_tags": ["..."],
    "orientation": "...",
    "tutorial": "...",
    "bgm": "unknown",
    "responsive_layout": "...",
    "controls": ["..."],
    "product_overview_150_words": "...",
    "features": [{"title": "...", "description_30_words": "..."}],
    "how_to_play": ["..."],
    "faq": [{"question": "...", "answer": "..."}],
    "taxonomy_new_suggestions": [{"field": "...", "suggestion": "...", "reason": "..."}]
  }
}
`.trim();
}

async function callGemini({ apiKey: key, model: modelName, env: envValues, timeoutMs, prompt, screenshots: imageInputs }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelName,
  )}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...imageInputs.map((image) => ({
            inline_data: {
              mime_type: image.mimeType,
              data: image.base64,
            },
          })),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const response = await geminiFetch(endpoint, {
    env: envValues,
    timeoutMs,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${responseText}`);
  }

  const json = JSON.parse(responseText);
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  if (!text.trim()) {
    throw new Error(`Gemini API returned no text: ${responseText}`);
  }
  return { text, raw: json };
}

function parseJsonText(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

function repairGeminiResult(parsed, sourceReport) {
  if (!parsed?.en || !parsed?.zh) return parsed;
  const fallback = buildFallbackProfile(sourceReport);
  const selected = fallback.selected;
  const repairs = [];

  fillArray(parsed.en, "target_audience", selected.audience.map((item) => item.name_en), repairs);
  fillText(parsed.en, "game_type", selected.gameType.map((item) => item.name_en).join(", "), repairs);
  fillText(parsed.en, "subgenre", selected.subType.map((item) => item.name_en).join(", ") || fallback.subgenreEn, repairs);
  fillArray(parsed.en, "theme", selected.theme.map((item) => item.name_en), repairs);
  fillText(parsed.en, "art_style", selected.artStyle.map((item) => item.name_en).join(", "), repairs);
  fillArray(parsed.en, "feature_tags", selected.featureTags.map((item) => item.name_en), repairs);
  fillArray(parsed.en, "controls", selected.controls.map((item) => item.name_en), repairs);
  fillArray(parsed.en, "how_to_play", fallback.howToPlayEn, repairs);
  parsed.en.product_overview_150_words = normalizeOverview(
    parsed.en.product_overview_150_words,
    fallback.overviewEn,
    sourceReport.collection_quality?.quality_warnings ?? [],
    repairs,
  );
  parsed.en.features = normalizeFeatures(parsed.en.features, fallback.featuresEn, repairs);
  if (!Array.isArray(parsed.en.faq) || !parsed.en.faq.length) {
    parsed.en.faq = [
      {
        question: `What type of game is ${sourceReport.game_name}?`,
        answer: `${sourceReport.game_name} appears to be ${parsed.en.game_type || fallback.gameModeEn}. This classification should be reviewed because the automated evidence is limited.`,
      },
      {
        question: "What controls does it use?",
        answer: `The current evaluation suggests ${parsed.en.controls?.join(", ") || "simple touch"} controls.`,
      },
      {
        question: "Is the evaluation final?",
        answer: "No. This record was generated from limited automated evidence and should be reviewed before production publishing.",
      },
    ];
    repairs.push("en.faq");
  }

  fillSelected(parsed.zh, "audience", selected.audience, repairs);
  fillSelected(parsed.zh, "game_type", selected.gameType, repairs);
  fillSelected(parsed.zh, "sub_type", selected.subType, repairs);
  fillSelected(parsed.zh, "theme", selected.theme, repairs);
  fillSelected(parsed.zh, "art_style", selected.artStyle, repairs);
  fillSelected(parsed.zh, "feature_tags", selected.featureTags, repairs);
  fillSelected(parsed.zh, "controls", selected.controls, repairs);

  const evidenceWarnings = sourceReport.collection_quality?.quality_warnings ?? [];
  if (evidenceWarnings.length) {
    parsed.zh.review_notes ??= [];
    parsed.zh.review_notes.push(
      `Evidence quality needs review: ${evidenceWarnings.map((item) => item.title || item.code).join(", ")}.`,
    );
    parsed.en.taxonomy_new_suggestions ??= [];
    parsed.en.taxonomy_new_suggestions.push({
      field: "evidence_quality",
      suggestion: "Review evidence before publishing",
      reason: evidenceWarnings.map((item) => item.detail || item.title || item.code).join(" | "),
    });
    repairs.push("evidence.quality_warnings");
  }

  if (repairs.length) {
    parsed.zh.review_notes ??= [];
    parsed.zh.review_notes.push(`Gemini result had empty required taxonomy fields; filled from local fallback for spreadsheet completeness: ${repairs.join(", ")}.`);
    parsed.en.taxonomy_new_suggestions ??= [];
    parsed.en.taxonomy_new_suggestions.push({
      field: "required_taxonomy_repair",
      suggestion: "Review repaired taxonomy fields",
      reason: `The Gemini result left required taxonomy fields empty, so local taxonomy fallbacks were used for spreadsheet completeness. Repaired fields: ${repairs.join(", ")}.`,
    });
  }

  return parsed;
}

function fillArray(target, key, fallbackValues, repairs) {
  if (Array.isArray(target[key]) && target[key].length) return;
  target[key] = fallbackValues;
  repairs.push(`en.${key}`);
}

function fillText(target, key, fallbackValue, repairs) {
  if (typeof target[key] === "string" && target[key].trim()) return;
  target[key] = fallbackValue;
  repairs.push(`en.${key}`);
}

function fillSelected(target, key, fallbackValues, repairs) {
  target[key] ??= {};
  if (Array.isArray(target[key].selected) && target[key].selected.length) return;
  target[key].selected = fallbackValues.map(({ id, name_zh }) => ({ id, name_zh }));
  target[key].needs_taxonomy_review = true;
  target[key].confidence = Math.min(Number(target[key].confidence ?? 0.5), 0.5);
  target[key].new_suggestions ??= [];
  repairs.push(`zh.${key}`);
}

function normalizeOverview(overview, fallbackOverview, qualityWarnings, repairs) {
  const warningText = Array.isArray(qualityWarnings) && qualityWarnings.length
    ? "Because this automated pass includes evidence quality warnings, editors should compare the screenshot set, local video clip, and trace files before treating the copy as final."
    : "Editors can use the evidence package, taxonomy selections, and local report together when preparing final publishing copy or comparing similar H5 games.";
  let next = String(overview || fallbackOverview || "").trim();
  if (!next) next = fallbackOverview || "";
  if (wordCount(next) < 120) {
    next = `${next} ${warningText}`.trim();
    repairs.push("en.product_overview_min_words");
  }
  if (wordCount(next) < 120 && fallbackOverview && !next.includes(fallbackOverview)) {
    next = `${next} ${fallbackOverview}`.trim();
    repairs.push("en.product_overview_fallback");
  }
  return next;
}

function normalizeFeatures(features, fallbackFeatures, repairs) {
  const fallback = Array.isArray(fallbackFeatures) ? fallbackFeatures : [];
  let next = Array.isArray(features)
    ? features
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        title: String(item.title || fallback[index]?.title || `Feature ${index + 1}`).trim(),
        description_30_words: String(item.description_30_words || item.description || fallback[index]?.description_30_words || "").trim(),
      }))
      .filter((item) => item.title && item.description_30_words)
    : [];

  if (next.length < 3) {
    for (const item of fallback) {
      if (next.length >= 3) break;
      if (!next.some((current) => current.title === item.title)) next.push(item);
    }
    repairs.push("en.features_min_count");
  }
  if (next.length > 6) {
    next = next.slice(0, 6);
    repairs.push("en.features_max_count");
  }
  if (!next.length) {
    next = fallback.slice(0, 3);
    repairs.push("en.features");
  }
  return next.map((item) => {
    const description = normalizeFeatureDescription(item.description_30_words);
    if (description !== item.description_30_words) repairs.push("en.features_word_count");
    return { ...item, description_30_words: description };
  });
}

function normalizeFeatureDescription(value) {
  const safetySentence = "Reviewers should verify this claim against screenshots, local video evidence, and manual gameplay before publishing the final store copy.";
  const text = String(value ?? "").trim();
  if (!text) return safetySentence;
  if (wordCount(text) >= 24) return text;
  return `${text} ${safetySentence}`;
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

async function writeEvaluationFiles({ gameDir: outputDir, gameId: id, model: modelName, screenshots: imageInputs, parsed, source, rawText }) {
  const generatedAt = new Date().toISOString();
  const sourceImages = imageInputs.map((image) => image.relativePath);
  const zhEval = {
    game_id: id,
    model: modelName,
    generated_at: generatedAt,
    evaluation_source: source,
    source_images: sourceImages,
    backend_language: "zh",
    export_language: "en",
    result: parsed.zh ?? parsed,
    raw_text: rawText,
  };

  const enEval = {
    game_id: id,
    model: modelName,
    generated_at: generatedAt,
    evaluation_source: source,
    source_images: sourceImages,
    result: parsed.en ?? parsed,
    raw_text: rawText,
  };

  await fs.writeFile(path.join(outputDir, "ai_eval.zh.json"), `${JSON.stringify(zhEval, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "ai_eval.en.json"), `${JSON.stringify(enEval, null, 2)}\n`, "utf8");
}

async function buildLocalFallbackEvaluation({ gameDir: outputDir, report: sourceReport }) {
  const observationsPath = path.join(outputDir, "manual_observations.zh.json");
  let observations = null;
  try {
    observations = JSON.parse(await fs.readFile(observationsPath, "utf8"));
  } catch {
    observations = {
      summary: "未找到人工观察文件，使用页面标题和截图文件名生成低置信度兜底结果。",
      gameplay_observations: [],
    };
  }

  const profile = buildFallbackProfile(sourceReport);
  const selected = profile.selected;
  const evidence = profile.evidence;

  return {
    zh: {
      evaluation_source_note: "本结果由本地兜底规则和人工截图观察生成，用于 POC 链路验证；接入多模态模型后应由模型结果替换。",
      manual_observations: observations,
      device_fit: {
        value: profile.deviceFitZh,
        confidence: 0.82,
        evidence,
      },
      audience: {
        selected: selected.audience.map(({ id, name_zh }) => ({ id, name_zh })),
        new_suggestions: [],
        needs_taxonomy_review: false,
        confidence: 0.78,
      },
      game_mode: { value: profile.gameModeZh, confidence: 0.72 },
      game_type: {
        selected: selected.gameType.map(({ id, name_zh }) => ({ id, name_zh })),
        new_suggestions: [],
        needs_taxonomy_review: false,
        confidence: 0.83,
      },
      sub_type: {
        selected: selected.subType.map(({ id, name_zh }) => ({ id, name_zh })),
        new_suggestions: profile.subTypeSuggestionsZh,
        needs_taxonomy_review: profile.subTypeSuggestionsZh.length > 0,
        confidence: 0.68,
      },
      theme: {
        selected: selected.theme.map(({ id, name_zh }) => ({ id, name_zh })),
        new_suggestions: [],
        needs_taxonomy_review: false,
        confidence: 0.86,
      },
      art_style: {
        selected: selected.artStyle.map(({ id, name_zh }) => ({ id, name_zh })),
        new_suggestions: [],
        needs_taxonomy_review: false,
        confidence: 0.82,
      },
      feature_tags: {
        selected: selected.featureTags.map(({ id, name_zh }) => ({ id, name_zh })),
        new_suggestions: profile.featureSuggestionsZh,
        needs_taxonomy_review: profile.featureSuggestionsZh.length > 0,
        confidence: 0.68,
      },
      orientation: { value: profile.orientationZh, confidence: 0.78 },
      tutorial: { value: "截图证据不足以稳定确认完整新手引导；本地兜底仅记录首屏和可点击入口。", confidence: 0.45 },
      bgm: { value: "unknown", confidence: 0.1 },
      responsive: { value: "已在桌面、手机竖屏、手机横屏和 Slow 4G 场景采集截图；具体适配质量需人工复核截图。", confidence: 0.7 },
      controls: {
        selected: selected.controls.map(({ id, name_zh }) => ({ id, name_zh })),
        new_suggestions: [],
        needs_taxonomy_review: false,
        confidence: 0.78,
      },
      how_to_play: profile.howToPlayZh,
      review_notes: profile.reviewNotesZh,
    },
    en: {
      device_compatibility: profile.deviceFitEn,
      target_audience: selected.audience.map((item) => item.name_en),
      game_mode: profile.gameModeEn,
      game_type: selected.gameType.map((item) => item.name_en).join(", "),
      subgenre: selected.subType.map((item) => item.name_en).join(", ") || profile.subgenreEn,
      theme: selected.theme.map((item) => item.name_en),
      art_style: selected.artStyle.map((item) => item.name_en).join(", "),
      feature_tags: selected.featureTags.map((item) => item.name_en),
      orientation: profile.orientationEn,
      tutorial: "The local fallback could not reliably confirm a complete tutorial flow from screenshots alone.",
      bgm: "unknown",
      responsive_layout: "The game produced screenshots across desktop, mobile portrait, mobile landscape, and Slow 4G test modes. Final layout quality should be reviewed from the evidence images.",
      controls: selected.controls.map((item) => item.name_en),
      product_overview_150_words: profile.overviewEn,
      features: profile.featuresEn,
      how_to_play: profile.howToPlayEn,
      faq: [
        {
          question: `What type of game is ${sourceReport.game_name}?`,
          answer: `${sourceReport.game_name} is currently classified by the local fallback as ${profile.gameModeEn.toLowerCase()}. This should be confirmed with the multimodal model or manual review.`,
        },
        {
          question: "What device is best for playing it?",
          answer: "The evidence includes desktop, mobile portrait, mobile landscape, and Slow 4G captures, so layout quality can be compared directly from the screenshots.",
        },
        {
          question: "Is this final editorial copy?",
          answer: "No. This text was generated by a local fallback rule for pipeline validation and should be replaced by Gemini or another multimodal model for production use.",
        },
      ],
      taxonomy_new_suggestions: profile.taxonomySuggestionsEn,
    },
  };
}

function buildFallbackProfile(sourceReport) {
  const haystack = `${sourceReport.game_id} ${sourceReport.game_name} ${sourceReport.page_title} ${sourceReport.keywords} ${sourceReport.url}`.toLowerCase();
  const gameName = sourceReport.game_name;
  const option = {
    action: { id: "gt_action", name_zh: "动作", name_en: "Action" },
    puzzle: { id: "gt_puzzle", name_zh: "益智", name_en: "Puzzle" },
    casual: { id: "gt_casual", name_zh: "休闲", name_en: "Casual" },
    simulation: { id: "gt_simulation", name_zh: "模拟", name_en: "Simulation" },
    runner: { id: "gt_runner", name_zh: "跑酷", name_en: "Runner" },
    match3: { id: "gt_match3", name_zh: "三消", name_en: "Match-3" },
    idle: { id: "gt_idle", name_zh: "放置", name_en: "Idle" },
    rescue: { id: "gt_rescue_puzzle", name_zh: "救援解谜", name_en: "Rescue Puzzle" },
    zombie: { id: "theme_zombie", name_zh: "僵尸", name_en: "Zombie" },
    city: { id: "theme_city", name_zh: "城市", name_en: "City" },
    animal: { id: "theme_animal", name_zh: "动物", name_en: "Animal" },
    farm: { id: "theme_farm", name_zh: "农场", name_en: "Farm" },
    magic: { id: "theme_magic", name_zh: "魔法奇幻", name_en: "Magic/Fantasy" },
    pixel: { id: "art_pixel", name_zh: "像素风", name_en: "Pixel Art" },
    cartoon3d: { id: "art_3d_cartoon", name_zh: "3D卡通", name_en: "3D Cartoon" },
    brain: { id: "tag_brain_teaser", name_zh: "烧脑", name_en: "Brain Teaser" },
    level: { id: "tag_level_based", name_zh: "关卡制", name_en: "Level-based" },
    easy: { id: "tag_easy_to_play", name_zh: "上手快", name_en: "Easy to Play" },
    short: { id: "tag_short_session", name_zh: "短局", name_en: "Short Session" },
    oneTouch: { id: "tag_one_touch", name_zh: "单指操作", name_en: "One-touch" },
    physics: { id: "tag_physics", name_zh: "物理机制", name_en: "Physics-based" },
    collecting: { id: "tag_collecting", name_zh: "收集", name_en: "Collecting" },
    upgrade: { id: "tag_upgrade", name_zh: "升级", name_en: "Upgrade" },
    casualPlayers: { id: "aud_casual_players", name_zh: "休闲玩家", name_en: "Casual Players" },
    puzzleLovers: { id: "aud_puzzle_lovers", name_zh: "解谜爱好者", name_en: "Puzzle Lovers" },
    teens: { id: "aud_teens", name_zh: "青少年", name_en: "Teens" },
    adults: { id: "aud_adults", name_zh: "成年人", name_en: "Adults" },
    tap: { id: "ctrl_tap", name_zh: "点击", name_en: "Tap" },
    drag: { id: "ctrl_drag", name_zh: "拖拽", name_en: "Drag" },
    swipe: { id: "ctrl_swipe", name_zh: "滑动", name_en: "Swipe" },
  };

  const base = {
    selected: {
      gameType: [option.casual],
      subType: [],
      theme: [option.city],
      artStyle: [option.cartoon3d],
      featureTags: [option.easy, option.short, option.oneTouch],
      audience: [option.casualPlayers],
      controls: [option.tap],
    },
    subTypeSuggestionsZh: [],
    featureSuggestionsZh: [],
    taxonomySuggestionsEn: [],
    gameModeZh: "单人休闲闯关",
    gameModeEn: "single-player casual play",
    subgenreEn: "Casual",
    deviceFitZh: "建议以手机端体验为主；桌面和横屏截图用于检查自适配情况。",
    deviceFitEn: "Best reviewed on mobile first, with desktop and landscape screenshots used to check responsive behavior.",
    orientationZh: "移动端优先，具体横竖屏表现需结合截图复核",
    orientationEn: "Mobile-first",
    evidence: [
      "工具已采集桌面、手机竖屏、手机横屏和 Slow 4G 场景截图。",
      `页面标题/URL 线索：${sourceReport.page_title || sourceReport.game_name}`,
      "本地兜底模式不做精细视觉理解，正式结论应由多模态模型复核。",
    ],
    howToPlayZh: ["点击 Play/Start 进入游戏。", "观察首屏目标、按钮和可交互区域。", "通过点击、拖拽或滑动完成关卡目标。"],
    howToPlayEn: ["Tap Play or Start to enter the game.", "Watch the first objective, buttons, and interactive areas.", "Use tap, drag, or swipe controls to progress."],
    reviewNotesZh: ["本地兜底标签置信度较低，建议用 Gemini 多模态复核。", "BGM 无法从截图判断，需要后续音频采集或浏览器音频检测。"],
    overviewEn: `${gameName} is an H5 mini game evaluated through the local fallback pipeline. The tool captured browser evidence across desktop, mobile portrait, mobile landscape, and Slow 4G profiles, then assigned provisional taxonomy labels from the configurable Feishu taxonomy table. These labels are useful for validating the workflow and filling required review fields, but they should be treated as low-confidence until a multimodal model reviews the screenshots and gameplay state. The current record includes device evidence, page metadata, package-size estimates, loading timings, basic controls, and draft English copy so the game can be tracked in Feishu while awaiting final editorial review.`,
    featuresEn: [
      { title: "H5 browser capture", description_30_words: "The tool opens each game across real browser profiles, captures screenshots, network summaries, loading timings, responsive layouts, and local evidence paths so reviewers can audit the gameplay record later." },
      { title: "Configurable taxonomy", description_30_words: "Gameplay type, audience, theme, art style, feature tags, and controls are selected from the Feishu-backed taxonomy list, with new suggestions flagged for human review instead of forced matching." },
      { title: "Review-ready output", description_30_words: "The generated record combines English copy, field confidence, screenshot paths, taxonomy review flags, and Feishu write previews, giving operators a structured starting point for final spreadsheet approval." },
    ],
  };

  if (/cow\s*saver|cowsaver/.test(haystack)) {
    return {
      ...base,
      selected: {
        gameType: [option.puzzle],
        subType: [option.rescue],
        theme: [option.animal, option.farm],
        artStyle: [option.cartoon3d],
        featureTags: [option.brain, option.level, option.physics, option.oneTouch],
        audience: [option.casualPlayers, option.puzzleLovers],
        controls: [option.tap, option.drag],
      },
      subTypeSuggestionsZh: ["拉针/机关救援解谜"],
      featureSuggestionsZh: ["救援主题", "机关拆解"],
      taxonomySuggestionsEn: [
        { field: "sub_type", suggestion: "Pin / Mechanism Rescue Puzzle", reason: "The captured level uses mechanical blocking pieces and a rescue objective." },
        { field: "feature_tags", suggestion: "Rescue Theme", reason: "The primary visible objective is rescuing a trapped animal." },
      ],
      gameModeZh: "单人关卡制解谜",
      gameModeEn: "single-player level-based puzzle",
      subgenreEn: "Rescue Puzzle",
    };
  }

  if (/pixel|match/.test(haystack)) {
    return {
      ...base,
      selected: {
        gameType: [option.puzzle],
        subType: [option.match3],
        theme: [option.magic],
        artStyle: [option.pixel],
        featureTags: [option.brain, option.level, option.easy, option.short],
        audience: [option.casualPlayers, option.puzzleLovers],
        controls: [option.tap, option.drag],
      },
      gameModeZh: "单人三消/匹配益智",
      gameModeEn: "single-player matching puzzle",
      subgenreEn: "Match-3",
      orientationZh: "移动端优先，匹配类玩法通常适合竖屏短局",
      orientationEn: "Mobile-first puzzle layout",
    };
  }

  if (/dead|rush|zombie/.test(haystack)) {
    return {
      ...base,
      selected: {
        gameType: [option.action],
        subType: [option.runner],
        theme: [option.zombie],
        artStyle: [option.cartoon3d],
        featureTags: [option.level, option.short, option.easy],
        audience: [option.casualPlayers, option.teens],
        controls: [option.tap, option.swipe],
      },
      gameModeZh: "单人动作闯关",
      gameModeEn: "single-player action run",
      subgenreEn: "Runner",
      orientationZh: "动作闯关类移动端优先，横屏/桌面表现需截图复核",
      orientationEn: "Mobile-first action layout",
    };
  }

  if (/idle|prison/.test(haystack)) {
    return {
      ...base,
      selected: {
        gameType: [option.simulation],
        subType: [option.idle],
        theme: [option.city],
        artStyle: [option.cartoon3d],
        featureTags: [option.collecting, option.upgrade, option.easy],
        audience: [option.casualPlayers, option.adults],
        controls: [option.tap],
      },
      subTypeSuggestionsZh: ["监狱经营/管理模拟"],
      featureSuggestionsZh: ["经营管理"],
      taxonomySuggestionsEn: [
        { field: "theme", suggestion: "Prison", reason: "The title indicates a prison-management setting that is not yet in the theme taxonomy." },
        { field: "feature_tags", suggestion: "Management", reason: "The title suggests management or idle-simulation progression." },
      ],
      gameModeZh: "单人放置经营模拟",
      gameModeEn: "single-player idle management simulation",
      subgenreEn: "Idle",
    };
  }

  return base;
}
