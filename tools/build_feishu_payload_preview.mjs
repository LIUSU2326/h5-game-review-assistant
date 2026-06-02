import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const gameId = args.gameId ?? args["game-id"] ?? "cow-saver";
const gameDir = path.join(root, "evidence", gameId);
const mappingPath = path.join(root, "mock_bitable", "feishu_field_mapping.csv");
const fieldComposerPath = path.join(root, "config", "field_composer.json");
const fieldComposerDefaultsPath = path.join(root, "config", "field_composer.defaults.json");

const collection = await readJson(path.join(gameDir, "report.zh.json"));
const aiZh = await readJson(path.join(gameDir, "ai_eval.zh.json"));
const aiEn = await readJson(path.join(gameDir, "ai_eval.en.json"));
const review = normalizeReview(await readJsonOrNull(path.join(gameDir, "review_status.json")));
const mappings = await readCsv(mappingPath);
const taxonomy = await readJsonOrNull(path.join(root, "config", "taxonomy_from_feishu.json"));
const fieldComposer = normalizeFieldComposer(
  (await readJsonOrNull(fieldComposerPath)) ?? (await readJsonOrNull(fieldComposerDefaultsPath)) ?? {},
);

const source = {
  game: {
    game_id: collection.game_id,
    game_name: collection.game_name,
    url: collection.url,
  },
  collection,
  ai: {
    evaluation_source: aiEn.evaluation_source ?? aiZh.evaluation_source,
    zh: aiZh.result ?? {},
    en: aiEn.result ?? {},
  },
  review,
  derived: {
    evidence_folder: gameDir,
    screenshot_paths: (collection.screenshots ?? []).map((item) => path.join(gameDir, item)),
    screenshot_uploads: [],
    trace_paths: (collection.traces ?? []).map((item) => path.join(gameDir, item)),
    needs_taxonomy_review: hasTaxonomySuggestions(aiZh.result, aiEn.result),
  },
};

const fields = {};
const fieldDiagnostics = [];

for (const mapping of mappings) {
  const rawValue = getPath(source, mapping.source_path);
  const value = normalizeForFeishu(rawValue, mapping.feishu_type);
  fields[mapping.field_name] = value;
  if (mapping.required === "true" && isEmptyValue(value)) {
    fieldDiagnostics.push({
      field_name: mapping.field_name,
      source_path: mapping.source_path,
      issue: "required_field_empty",
    });
  }
}

const taxonomyPreflight = buildTaxonomyPreflight(fields, mappings, taxonomy);
if (taxonomyPreflight.status !== "ready") {
  source.derived.needs_taxonomy_review = true;
  fields["Needs Taxonomy Review"] = true;
  if (taxonomyPreflight.missing_options.length) {
    fields["Taxonomy Suggestions"] = appendTaxonomyPreflightSuggestions(
      fields["Taxonomy Suggestions"],
      taxonomyPreflight.missing_options,
    );
  }
}
const categoryRecords = buildCategoryRecords(fieldComposer, source);
const categoryDiagnostics = categoryRecords.flatMap((record) => record.diagnostics ?? []);

const payload = {
  game_id: gameId,
  generated_at: new Date().toISOString(),
  status: fieldDiagnostics.length || categoryDiagnostics.length
    ? "needs_mapping_review"
    : taxonomyPreflight.status !== "ready"
      ? "taxonomy_review_required"
      : "ready_to_write",
  target: {
    platform: "feishu_bitable",
    mode: "preview_only",
    app_token: "TO_BE_CONFIGURED",
    table_id: "TO_BE_CONFIGURED",
  },
  record: { fields },
  category_records: categoryRecords,
  diagnostics: fieldDiagnostics,
  category_diagnostics: categoryDiagnostics,
  taxonomy_preflight: taxonomyPreflight,
  mapping_file: path.relative(root, mappingPath).replaceAll("\\", "/"),
  field_composer_file: path.relative(root, fieldComposerPath).replaceAll("\\", "/"),
  source_files: {
    collection_report: path.relative(root, path.join(gameDir, "report.zh.json")).replaceAll("\\", "/"),
    ai_eval_zh: path.relative(root, path.join(gameDir, "ai_eval.zh.json")).replaceAll("\\", "/"),
    ai_eval_en: path.relative(root, path.join(gameDir, "ai_eval.en.json")).replaceAll("\\", "/"),
    review_status: path.relative(root, path.join(gameDir, "review_status.json")).replaceAll("\\", "/"),
  },
};

const outPath = path.join(gameDir, "feishu_payload_preview.json");
await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Feishu payload preview written to ${outPath}`);
console.log(`Status: ${payload.status}`);

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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readCsv(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return parseCsv(text);
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

function getPath(source, sourcePath) {
  return sourcePath.split(".").reduce((value, key) => {
    if (value == null) return undefined;
    return value[key];
  }, source);
}

function normalizeFieldComposer(source) {
  const fields = (source.fields ?? [])
    .map((field) => ({
      id: String(field.id ?? "").trim(),
      field_name: String(field.field_name ?? "").trim(),
      source_path: String(field.source_path ?? "").trim(),
      feishu_type: normalizeFeishuType(field.feishu_type),
      required: Boolean(field.required),
    }))
    .filter((field) => field.id && field.field_name && field.source_path);
  const fieldIds = new Set(fields.map((field) => field.id));
  const categories = (source.categories ?? [])
    .map((category) => ({
      id: String(category.id ?? "").trim(),
      label_zh: String(category.label_zh ?? category.table_name ?? "").trim(),
      table_name: String(category.table_name ?? category.label_zh ?? "").trim(),
      field_ids: [...new Set((category.field_ids ?? []).map((id) => String(id).trim()).filter((id) => fieldIds.has(id)))],
    }))
    .filter((category) => category.id && category.table_name && category.field_ids.length);
  return { fields, categories };
}

function normalizeFeishuType(type) {
  const value = String(type ?? "text").trim();
  return ["text", "long_text", "number", "single_select", "multi_select", "checkbox", "url", "attachment"].includes(value) ? value : "text";
}

function buildCategoryRecords(composer, source) {
  const fieldsById = new Map((composer.fields ?? []).map((field) => [field.id, field]));
  return (composer.categories ?? []).map((category) => {
    const recordFields = {};
    const diagnostics = [];
    for (const fieldId of category.field_ids ?? []) {
      const field = fieldsById.get(fieldId);
      if (!field) continue;
      const rawValue = getPath(source, field.source_path);
      const value = normalizeForFeishu(rawValue, field.feishu_type);
      recordFields[field.field_name] = value;
      if (field.required && isEmptyValue(value)) {
        diagnostics.push({
          table_name: category.table_name,
          field_name: field.field_name,
          source_path: field.source_path,
          issue: "required_field_empty",
        });
      }
    }
    return {
      category_id: category.id,
      label_zh: category.label_zh,
      table_name: category.table_name,
      fields: recordFields,
      diagnostics,
    };
  }).filter((record) => Object.keys(record.fields).length);
}

function normalizeForFeishu(value, type) {
  if (value == null) return null;
  if (type === "number") return Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "checkbox") return Boolean(value);
  if (type === "multi_select") {
    if (Array.isArray(value)) return value.map(stringifyOption).filter(Boolean);
    if (typeof value === "string" && value.trim()) return splitOptionText(value);
    return [];
  }
  if (type === "single_select") {
    if (Array.isArray(value)) return stringifyOption(value[0]) || null;
    return stringifyOption(value);
  }
  if (type === "long_text") return stringifyLongText(value);
  if (type === "url") return String(value);
  if (type === "attachment") return Array.isArray(value) ? value : [];
  return stringifyLongText(value);
}

function stringifyOption(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") return value.name_en ?? value.name_zh ?? value.suggestion ?? value.title ?? JSON.stringify(value);
  return String(value);
}

function splitOptionText(value) {
  return String(value ?? "")
    .split(/[,，;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTaxonomyPreflight(fields, mappings, taxonomySource) {
  const checkedFields = [];
  const missingOptions = [];
  const categories = taxonomySource?.categories ?? {};
  const categoryIndexes = new Map(
    Object.entries(categories).map(([category, options]) => [category, buildTaxonomyOptionIndex(options)]),
  );
  const taxonomyStatus = taxonomySource?.status || "missing";

  for (const mapping of mappings) {
    const category = taxonomyCategoryForField(mapping.field_name);
    if (!category) continue;
    const values = normalizeTaxonomyFieldValues(fields[mapping.field_name]);
    const known = categoryIndexes.get(category) ?? new Set();
    const fieldMissing = values.filter((value) => !known.has(normalizeTaxonomyKey(value)));
    const status = !taxonomySource?.option_count
      ? "taxonomy_not_synced"
      : fieldMissing.length
        ? "missing_options"
        : "ready";
    checkedFields.push({
      field_name: mapping.field_name,
      category,
      feishu_type: mapping.feishu_type,
      values,
      missing_options: fieldMissing,
      status,
    });
    for (const value of fieldMissing) {
      missingOptions.push({
        field_name: mapping.field_name,
        category,
        option: value,
        suggestion: value,
      });
    }
  }

  return {
    status: missingOptions.length ? "needs_review" : taxonomySource?.option_count ? "ready" : "taxonomy_not_synced",
    taxonomy_status: taxonomyStatus,
    taxonomy_table_id: taxonomySource?.table_id ?? "",
    option_count: taxonomySource?.option_count ?? 0,
    checked_fields: checkedFields,
    missing_options: missingOptions,
  };
}

function buildTaxonomyOptionIndex(options) {
  const keys = new Set();
  for (const option of Array.isArray(options) ? options : []) {
    for (const value of [option.id, option.name_en, option.name_zh]) {
      const key = normalizeTaxonomyKey(value);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function normalizeTaxonomyFieldValues(value) {
  if (Array.isArray(value)) return value.map(stringifyOption).filter(Boolean);
  if (typeof value === "string") return splitOptionText(value);
  return value == null ? [] : [stringifyOption(value)].filter(Boolean);
}

function normalizeTaxonomyKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function taxonomyCategoryForField(fieldName) {
  const categories = {
    "Target Audience": "audiences",
    "Game Type": "gameplay_types",
    "Subgenre": "gameplay_types",
    "Theme": "themes",
    "Art Style": "art_styles",
    "Feature Tags": "feature_tags",
    "Controls": "controls",
  };
  return categories[fieldName] ?? "";
}

function appendTaxonomyPreflightSuggestions(currentValue, missingOptions) {
  const current = stringifyLongText(currentValue).trim();
  const lines = missingOptions.map((item) => `${item.field_name}: ${item.option}\nNot found in ${item.category}; review before writing to Feishu.`);
  return [current, ...lines].filter(Boolean).join("\n\n");
}

function stringifyLongText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item.question && item.answer) return `Q: ${item.question}\nA: ${item.answer}`;
        if (item.title && item.description_30_words) return `${item.title}: ${item.description_30_words}`;
        if (item.field && item.suggestion) return `${item.field}: ${item.suggestion}\n${item.reason ?? ""}`.trim();
        return JSON.stringify(item);
      })
      .join("\n\n");
  }
  return JSON.stringify(value);
}

function isEmptyValue(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function hasTaxonomySuggestions(zhResult, enResult) {
  const zhFields = ["sub_type", "feature_tags", "game_type", "theme", "art_style", "audience", "controls"];
  if (zhFields.some((field) => (zhResult?.[field]?.new_suggestions ?? []).length > 0)) return true;
  return (enResult?.taxonomy_new_suggestions ?? []).length > 0;
}

function normalizeReview(review) {
  const status = ["pending", "approved", "needs_changes"].includes(review?.status) ? review.status : "pending";
  const statusLabels = {
    pending: "Pending",
    approved: "Approved",
    needs_changes: "Needs Changes",
  };
  return {
    status,
    status_label_en: statusLabels[status],
    notes: String(review?.notes ?? ""),
    updated_at: String(review?.updated_at ?? ""),
  };
}
