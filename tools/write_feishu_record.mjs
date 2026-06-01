import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const gameId = args.gameId ?? args["game-id"] ?? "cow-saver";
const apply = Boolean(args.apply);
const forceCreate = Boolean(args["force-create"]);
const configPath = path.join(root, "config", "feishu.local.json");
const payloadPath = path.join(root, "evidence", gameId, "feishu_payload_preview.json");
const outPath = path.join(root, "evidence", gameId, apply ? "feishu_write_result.json" : "feishu_write_dry_run.json");
const screenshotUploadPath = path.join(root, "evidence", gameId, "screenshot_upload_result.json");

const config = await readJson(configPath, "Missing config/feishu.local.json.");
const payload = await readJson(payloadPath, `Missing ${payloadPath}. Run npm.cmd run poc:feishu:preview first.`);
const tableConfig = config?.bitable?.tables?.evaluation_results ?? {};
const appToken = config?.bitable?.app_token;
const tableId = tableConfig.table_id;

const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? "apply" : "dry_run",
  status: "unknown",
  game_id: gameId,
  table_id: tableId || "",
  field_count: 0,
  missing_fields: [],
  record_id: "",
  record_url: "",
  matched_existing_record_id: "",
  action: "",
  screenshot_upload: {
    enabled: Boolean(config?.bitable?.upload_screenshots),
    status: Boolean(config?.bitable?.upload_screenshots) ? "pending" : "disabled",
    uploaded_count: 0,
    reused_count: 0,
    failed_count: 0,
  },
};

try {
  assertConfig(config, appToken, tableId);
  const tenantToken = await getTenantAccessToken(config.app_id, config.app_secret);
  const remoteFields = await listFields(tenantToken, appToken, tableId);
  const remoteByName = new Map(remoteFields.map((field) => [field.field_name, field]));
  const rawFields = { ...(payload.record?.fields ?? {}) };
  if (config?.bitable?.upload_screenshots && apply) {
    const uploadReport = await uploadScreenshotAttachments(tenantToken, appToken, rawFields);
    report.screenshot_upload = summarizeScreenshotUpload(uploadReport);
    rawFields["Screenshot Attachments"] = uploadReport.files
      .filter((item) => item.status === "uploaded" || item.status === "reused")
      .map((item) => ({ file_token: item.file_token }));
  } else if (config?.bitable?.upload_screenshots) {
    report.screenshot_upload.status = "skipped_dry_run";
    delete rawFields["Screenshot Attachments"];
  } else {
    delete rawFields["Screenshot Attachments"];
  }
  const missingFields = Object.keys(rawFields).filter((fieldName) => !remoteByName.has(fieldName));
  report.missing_fields = missingFields;

  if (missingFields.length) {
    report.status = "missing_fields";
  } else {
    const fields = {};
    for (const [fieldName, value] of Object.entries(rawFields)) {
      fields[fieldName] = normalizeValueForRemoteField(value, remoteByName.get(fieldName));
    }
    report.field_count = Object.keys(fields).length;
    const existingRecord = forceCreate ? null : await findExistingRecord(tenantToken, appToken, tableId, rawFields);
    report.matched_existing_record_id = existingRecord?.record_id ?? "";
    report.action = existingRecord ? "update" : "create";

    if (apply) {
      const record = existingRecord
        ? await updateRecord(tenantToken, appToken, tableId, existingRecord.record_id, fields)
        : await createRecord(tenantToken, appToken, tableId, fields);
      report.status = existingRecord ? "updated" : "written";
      report.record_id = record.record_id ?? record.id ?? "";
      report.record_url = record.record_url ?? record.url ?? "";
    } else {
      report.status = "dry_run_ready";
      report.preview = { fields };
    }
  }
} catch (error) {
  report.status = "failed";
  report.error = {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
  };
}

await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Feishu write ${apply ? "result" : "dry run"} written to ${outPath}`);
console.log(`Status: ${report.status}`);
console.log(`Fields: ${report.field_count}`);
if (report.record_id) console.log(`Record ID: ${report.record_id}`);
if (report.action) console.log(`Action: ${report.action}`);
if (report.missing_fields.length) console.log(`Missing fields: ${report.missing_fields.length}`);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
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

async function readJson(filePath, missingMessage) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error(missingMessage);
  }
}

function assertConfig(configSource, configAppToken, configTableId) {
  if (!configSource?.app_id || !configSource?.app_secret) {
    throw new Error("app_id or app_secret is missing in config/feishu.local.json.");
  }
  if (!configAppToken) throw new Error("bitable.app_token is missing in config/feishu.local.json.");
  if (!configTableId) throw new Error("evaluation_results.table_id is missing in config/feishu.local.json.");
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

async function listFields(accessToken, configAppToken, configTableId) {
  const fields = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(configTableId)}/fields`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable fields", json);
    fields.push(...(json.data?.items ?? []).map(normalizeRemoteField));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return fields;
}

async function uploadScreenshotAttachments(accessToken, configAppToken, rawFields) {
  const screenshotPaths = parseScreenshotPaths(rawFields.Screenshots);
  const existingReport = await readJsonOrNull(screenshotUploadPath);
  const cache = new Map(
    (existingReport?.files ?? [])
      .filter((item) => item.file_token && item.cache_key)
      .map((item) => [item.cache_key, item]),
  );
  const report = {
    generated_at: new Date().toISOString(),
    status: "pending",
    storage: "feishu_bitable_attachment",
    local_only_video: true,
    files: [],
  };

  for (const filePath of screenshotPaths) {
    const item = {
      local_path: filePath,
      file_name: path.basename(filePath),
      status: "pending",
      file_token: "",
      size: 0,
      cache_key: "",
      error: "",
    };
    try {
      const stat = await fs.stat(filePath);
      item.size = stat.size;
      item.cache_key = `${filePath}|${stat.size}|${Math.round(stat.mtimeMs)}`;
      const cached = cache.get(item.cache_key);
      if (cached?.file_token) {
        item.status = "reused";
        item.file_token = cached.file_token;
      } else {
        item.file_token = await uploadMedia(accessToken, configAppToken, filePath, stat.size);
        item.status = "uploaded";
      }
    } catch (error) {
      item.status = "failed";
      item.error = error?.message ?? String(error);
    }
    report.files.push(item);
  }

  const failedCount = report.files.filter((item) => item.status === "failed").length;
  report.status = failedCount ? "partial_failed" : "ready";
  await fs.writeFile(screenshotUploadPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function parseScreenshotPaths(value) {
  return stringify(value)
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function summarizeScreenshotUpload(uploadReport) {
  const files = uploadReport.files ?? [];
  return {
    enabled: true,
    status: uploadReport.status,
    uploaded_count: files.filter((item) => item.status === "uploaded").length,
    reused_count: files.filter((item) => item.status === "reused").length,
    failed_count: files.filter((item) => item.status === "failed").length,
    attachment_count: files.filter((item) => item.file_token).length,
    report_file: path.relative(root, screenshotUploadPath).replaceAll("\\", "/"),
  };
}

async function uploadMedia(accessToken, configAppToken, filePath, size) {
  const bytes = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "bitable_image");
  form.append("parent_node", configAppToken);
  form.append("size", String(size));
  form.append("file", new Blob([bytes], { type: mimeType(filePath) }), fileName);
  const response = await fetch("https://open.feishu.cn/open-apis/drive/v1/medias/upload_all", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError(`Failed to upload screenshot ${fileName}`, json);
  const fileToken = json.data?.file_token ?? json.data?.file?.file_token ?? "";
  if (!fileToken) throw new Error(`Failed to upload screenshot ${fileName}: missing file_token.`);
  return fileToken;
}

async function createRecord(accessToken, configAppToken, configTableId, fields) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(configTableId)}/records`);
  url.searchParams.set("client_token", randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", { fields });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create Bitable record", json);
  return json.data?.record ?? json.data ?? {};
}

async function updateRecord(accessToken, configAppToken, configTableId, recordId, fields) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(configTableId)}/records/${encodeURIComponent(recordId)}`);
  const response = await feishuFetch(url, accessToken, "PUT", { fields });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to update Bitable record", json);
  return json.data?.record ?? json.data ?? {};
}

async function findExistingRecord(accessToken, configAppToken, configTableId, rawFields) {
  const gameIdValue = stringify(rawFields["Game ID"]).trim();
  const gameUrlValue = stringify(rawFields["Game URL"]).trim();
  if (!gameIdValue && !gameUrlValue) return null;
  const records = await listRecords(accessToken, configAppToken, configTableId);
  return (
    records.find((record) => {
      const fields = record.fields ?? {};
      return (
        (gameIdValue && normalizeComparable(fields["Game ID"]) === gameIdValue) ||
        (gameUrlValue && normalizeComparable(fields["Game URL"]) === gameUrlValue)
      );
    }) ?? null
  );
}

async function listRecords(accessToken, configAppToken, configTableId) {
  const records = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(configTableId)}/records`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable records", json);
    records.push(...(json.data?.items ?? []).map(normalizeRemoteRecord));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return records;
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

function normalizeRemoteRecord(record) {
  return {
    ...record,
    record_id: record.record_id ?? record.id ?? "",
    fields: record.fields ?? {},
  };
}

function normalizeRemoteField(field) {
  return {
    ...field,
    field_id: field.field_id ?? field.id ?? "",
    field_name: field.field_name ?? field.name ?? "",
    type: Number(field.type),
  };
}

function normalizeValueForRemoteField(value, field) {
  if (field.type === 2) return Number.isFinite(Number(value)) ? Number(value) : null;
  if (field.type === 3) {
    if (Array.isArray(value)) return stringify(value[0]);
    return stringify(value);
  }
  if (field.type === 4) {
    if (Array.isArray(value)) return value.map(stringify).filter(Boolean);
    const text = stringify(value);
    return text ? [text] : [];
  }
  if (field.type === 7) return Boolean(value);
  if (field.type === 17) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (typeof item === "string") return { file_token: item };
        if (item?.file_token) return { file_token: item.file_token };
        return null;
      })
      .filter(Boolean);
  }
  if (field.type === 15) {
    const link = stringify(value);
    return link ? { text: link, link } : null;
  }
  return stringify(value);
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join("\n");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function normalizeComparable(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(normalizeComparable).filter(Boolean).join("\n").trim();
  if (typeof value === "object") {
    if (value.text) return String(value.text).trim();
    if (value.link) return String(value.link).trim();
    if (value.value) return String(value.value).trim();
    if (value.name) return String(value.name).trim();
  }
  return stringify(value).trim();
}

function createFeishuError(prefix, responseJson) {
  const error = new Error(`${prefix}: ${JSON.stringify(responseJson)}`);
  error.code = responseJson?.code;
  error.response = responseJson;
  return error;
}
