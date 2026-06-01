import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const configPath = path.join(root, "config", "feishu.local.json");
const seedPath = path.join(root, "mock_bitable", "taxonomy_options_seed.csv");
const outPath = path.join(root, "config", "feishu_taxonomy_setup_report.json");
const tableName = args.name ?? "Taxonomy Options";

const config = await readJson(configPath, "Missing config/feishu.local.json.");
const appToken = config?.bitable?.app_token;
const seedRows = await readCsv(seedPath);

const fieldDefinitions = [
  { field_name: "Category", type: 1 },
  { field_name: "Option ID", type: 1 },
  { field_name: "Parent ID", type: 1 },
  { field_name: "Level", type: 1 },
  { field_name: "Name EN", type: 1 },
  { field_name: "Name ZH", type: 1 },
  { field_name: "Enabled", type: 7 },
  { field_name: "Description ZH", type: 1 },
  { field_name: "Source File", type: 1 },
];

const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? "apply" : "dry_run",
  status: "unknown",
  table_name: tableName,
  table_id: "",
  table_action: "",
  seed_rows: seedRows.length,
  created_records: 0,
  updated_config: false,
};

try {
  assertConfig(config, appToken);
  const tenantToken = await getTenantAccessToken(config.app_id, config.app_secret);
  const existingTables = await listTables(tenantToken, appToken);
  const existing = existingTables.find((table) => table.name === tableName);

  if (!apply) {
    report.status = "dry_run_ready";
    report.table_id = existing?.table_id ?? "";
    report.table_action = existing ? "reuse_existing" : "create";
  } else {
    let table = existing;
    if (table) {
      report.table_action = "reuse_existing";
    } else {
      table = await createTable(tenantToken, appToken, tableName);
      report.table_action = "created";
      await delay(500);
    }
    report.table_id = table.table_id;

    await ensureFields(tenantToken, appToken, table.table_id);
    const existingRecords = await listRecords(tenantToken, appToken, table.table_id);
    const existingKeys = new Set(
      existingRecords.map((record) => `${normalizeText(record.fields?.Category)}::${normalizeText(record.fields?.["Option ID"])}`),
    );
    for (const row of seedRows) {
      const key = `${row.Category}::${row["Option ID"]}`;
      if (existingKeys.has(key)) continue;
      await createRecord(tenantToken, appToken, table.table_id, {
        Category: row.Category,
        "Option ID": row["Option ID"],
        "Parent ID": row["Parent ID"],
        Level: row.Level,
        "Name EN": row["Name EN"],
        "Name ZH": row["Name ZH"],
        Enabled: normalizeEnabled(row.Enabled),
        "Description ZH": row["Description ZH"],
        "Source File": row["Source File"],
      });
      report.created_records += 1;
      await delay(120);
    }

    updateConfig(config, table.table_id);
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    report.updated_config = true;
    report.status = "ready";
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
console.log(`Feishu taxonomy setup report written to ${outPath}`);
console.log(`Status: ${report.status}`);
console.log(`Table action: ${report.table_action || "-"}`);
console.log(`Table ID: ${report.table_id || "-"}`);
console.log(`Created records: ${report.created_records}`);

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

async function readCsv(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return parseCsv(text);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
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

function assertConfig(configSource, configAppToken) {
  if (!configSource?.app_id || !configSource?.app_secret) {
    throw new Error("app_id or app_secret is missing in config/feishu.local.json.");
  }
  if (!configAppToken) throw new Error("bitable.app_token is missing in config/feishu.local.json.");
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

async function listTables(accessToken, configAppToken) {
  const tables = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable tables", json);
    tables.push(...(json.data?.items ?? []).map(normalizeTable));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return tables;
}

async function createTable(accessToken, configAppToken, name) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables`);
  url.searchParams.set("client_token", randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", {
    table: {
      name,
      default_view_name: "Grid",
      fields: fieldDefinitions.slice(0, 1),
    },
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create Bitable table", json);
  return normalizeTable(json.data?.table ?? json.data ?? {});
}

async function ensureFields(accessToken, configAppToken, tableId) {
  const existing = await listFields(accessToken, configAppToken, tableId);
  const existingNames = new Set(existing.map((field) => field.field_name));
  for (const definition of fieldDefinitions) {
    if (existingNames.has(definition.field_name)) continue;
    await createField(accessToken, configAppToken, tableId, definition);
    await delay(120);
  }
}

async function listFields(accessToken, configAppToken, tableId) {
  const fields = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(tableId)}/fields`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable fields", json);
    fields.push(...(json.data?.items ?? []).map(normalizeField));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return fields;
}

async function createField(accessToken, configAppToken, tableId, field) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(tableId)}/fields`);
  url.searchParams.set("client_token", randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", field);
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create Bitable field", json);
  return normalizeField(json.data?.field ?? json.data ?? {});
}

async function listRecords(accessToken, configAppToken, tableId) {
  const records = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(tableId)}/records`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await feishuFetch(url, accessToken, "GET");
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable records", json);
    records.push(...(json.data?.items ?? []).map((record) => ({
      ...record,
      record_id: record.record_id ?? record.id ?? "",
      fields: record.fields ?? {},
    })));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return records;
}

async function createRecord(accessToken, configAppToken, tableId, fields) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(tableId)}/records`);
  url.searchParams.set("client_token", randomUUID());
  const response = await feishuFetch(url, accessToken, "POST", { fields });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw createFeishuError("Failed to create Bitable record", json);
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

function normalizeTable(table) {
  return {
    ...table,
    table_id: table.table_id ?? table.id ?? "",
    name: table.name ?? table.table_name ?? "",
  };
}

function normalizeField(field) {
  return {
    ...field,
    field_id: field.field_id ?? field.id ?? "",
    field_name: field.field_name ?? field.name ?? "",
  };
}

function updateConfig(configSource, tableId) {
  configSource.bitable ??= {};
  configSource.bitable.tables ??= {};
  configSource.bitable.tables.taxonomy_options ??= {};
  configSource.bitable.tables.taxonomy_options.table_id = tableId;
  configSource.bitable.tables.taxonomy_options.view_id ??= "";
  configSource.bitable.tables.taxonomy_options.seed_file = "mock_bitable/taxonomy_options_seed.csv";
}

function normalizeText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.text) return String(value.text).trim();
    if (value.value) return String(value.value).trim();
    if (value.name) return String(value.name).trim();
  }
  return JSON.stringify(value);
}

function normalizeEnabled(value) {
  return String(value).trim().toLowerCase() !== "false";
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
