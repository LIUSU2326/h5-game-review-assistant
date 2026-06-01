import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const configPath = path.join(root, "config", "feishu.local.json");
const mappingPath = path.join(root, "mock_bitable", "feishu_field_mapping.csv");
const outPath = path.join(root, "config", "feishu_field_create_report.json");

const config = await readJson(configPath, "Missing config/feishu.local.json.");
const tableConfig = config?.bitable?.tables?.evaluation_results ?? {};
const appToken = config?.bitable?.app_token;
const tableId = tableConfig.table_id;
const mappings = await readCsv(mappingPath);

const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? "apply" : "dry_run",
  status: "unknown",
  table_id: tableId || "",
  existing_field_count: 0,
  planned_fields: [],
  created_fields: [],
  skipped_fields: [],
  failed_fields: [],
};

try {
  assertConfig(config, appToken, tableId);
  const tenantToken = await getTenantAccessToken(config.app_id, config.app_secret);
  const existingFields = await listFields(tenantToken, appToken, tableId);
  const existingNames = new Set(existingFields.map((field) => field.field_name));
  report.existing_field_count = existingFields.length;

  for (const mapping of mappings) {
    if (existingNames.has(mapping.field_name)) {
      report.skipped_fields.push({ field_name: mapping.field_name, reason: "already_exists" });
      continue;
    }
    const planned = {
      field_name: mapping.field_name,
      mapping_type: mapping.feishu_type,
      type: fieldTypeForMapping(mapping.feishu_type),
      type_label: fieldTypeLabel(fieldTypeForMapping(mapping.feishu_type)),
    };
    report.planned_fields.push(planned);
  }

  if (apply) {
    for (const planned of report.planned_fields) {
      try {
        const created = await createField(tenantToken, appToken, tableId, planned);
        report.created_fields.push({
          field_id: created.field_id,
          field_name: created.field_name,
          type: created.type,
          type_label: fieldTypeLabel(created.type),
        });
        await delay(160);
      } catch (error) {
        report.failed_fields.push({
          field_name: planned.field_name,
          message: error?.message ?? String(error),
          code: error?.code,
        });
      }
    }
  }

  if (report.failed_fields.length) {
    report.status = "partial_failed";
  } else if (!apply) {
    report.status = report.planned_fields.length ? "dry_run_ready" : "nothing_to_create";
  } else {
    report.status = report.created_fields.length ? "created" : "nothing_to_create";
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
console.log(`Feishu field create report written to ${outPath}`);
console.log(`Mode: ${report.mode}`);
console.log(`Status: ${report.status}`);
console.log(`Planned fields: ${report.planned_fields.length}`);
console.log(`Created fields: ${report.created_fields.length}`);
console.log(`Failed fields: ${report.failed_fields.length}`);

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

async function readJson(filePath, missingMessage) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error(missingMessage);
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

async function createField(accessToken, configAppToken, configTableId, planned) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(configTableId)}/fields`);
  url.searchParams.set("client_token", randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", {
    field_name: planned.field_name,
    type: planned.type,
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create Bitable field", json);
  return normalizeRemoteField(json.data?.field ?? json.data ?? {});
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

function normalizeRemoteField(field) {
  return {
    ...field,
    field_id: field.field_id ?? field.id ?? "",
    field_name: field.field_name ?? field.name ?? "",
    type: Number(field.type),
  };
}

function fieldTypeForMapping(type) {
  const normalized = type.trim();
  if (normalized === "number") return 2;
  if (normalized === "single_select") return 3;
  if (normalized === "multi_select") return 4;
  if (normalized === "checkbox") return 7;
  if (normalized === "attachment") return 17;
  return 1;
}

function fieldTypeLabel(type) {
  const labels = new Map([
    [1, "Text"],
    [2, "Number"],
    [3, "Single Select"],
    [4, "Multi Select"],
    [7, "Checkbox"],
    [17, "Attachment"],
  ]);
  return labels.get(Number(type)) ?? "Unknown";
}

function createFeishuError(prefix, responseJson) {
  const error = new Error(`${prefix}: ${JSON.stringify(responseJson)}`);
  error.code = responseJson?.code;
  error.response = responseJson;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
