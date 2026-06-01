import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const gameId = args.gameId ?? args["game-id"] ?? "cow-saver";
const gameDir = path.join(root, "evidence", gameId);
const mappingPath = path.join(root, "mock_bitable", "feishu_field_mapping.csv");

const collection = await readJson(path.join(gameDir, "report.zh.json"));
const aiZh = await readJson(path.join(gameDir, "ai_eval.zh.json"));
const aiEn = await readJson(path.join(gameDir, "ai_eval.en.json"));
const review = normalizeReview(await readJsonOrNull(path.join(gameDir, "review_status.json")));
const mappings = await readCsv(mappingPath);

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

const payload = {
  game_id: gameId,
  generated_at: new Date().toISOString(),
  status: fieldDiagnostics.length ? "needs_mapping_review" : "ready_to_write",
  target: {
    platform: "feishu_bitable",
    mode: "preview_only",
    app_token: "TO_BE_CONFIGURED",
    table_id: "TO_BE_CONFIGURED",
  },
  record: { fields },
  diagnostics: fieldDiagnostics,
  mapping_file: path.relative(root, mappingPath).replaceAll("\\", "/"),
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

function normalizeForFeishu(value, type) {
  if (value == null) return null;
  if (type === "number") return Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "checkbox") return Boolean(value);
  if (type === "multi_select") {
    if (Array.isArray(value)) return value.map(stringifyOption).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
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
