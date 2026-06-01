import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "feishu.local.json");
const mappingPath = path.join(root, "mock_bitable", "feishu_field_mapping.csv");
const outPath = path.join(root, "config", "feishu_table_fields_check.json");

const config = await readJson(configPath, "Missing config/feishu.local.json.");
const tableConfig = config?.bitable?.tables?.evaluation_results ?? {};
const appToken = config?.bitable?.app_token;
const tableId = tableConfig.table_id;
const mappings = await readCsv(mappingPath);

const report = {
  checked_at: new Date().toISOString(),
  status: "unknown",
  table_id: tableId || "",
  total_remote_fields: 0,
  total_expected_fields: mappings.length,
  remote_fields: [],
  missing_fields: [],
  type_warnings: [],
  ready_for_write: false,
};

try {
  assertConfig(config, appToken, tableId);
  const tenantToken = await getTenantAccessToken(config.app_id, config.app_secret);
  const remoteFields = await listFields(tenantToken, appToken, tableId);
  const remoteByName = new Map(remoteFields.map((field) => [field.field_name, field]));

  report.remote_fields = remoteFields.map((field) => ({
    field_id: field.field_id,
    field_name: field.field_name,
    type: field.type,
    type_label: fieldTypeLabel(field.type),
  }));
  report.total_remote_fields = remoteFields.length;

  for (const mapping of mappings) {
    const remote = remoteByName.get(mapping.field_name);
    if (!remote) {
      report.missing_fields.push({
        field_name: mapping.field_name,
        expected_type: mapping.feishu_type,
        required: mapping.required === "true",
      });
      continue;
    }
    const acceptedTypes = acceptedFieldTypes(mapping.feishu_type);
    if (acceptedTypes.length && !acceptedTypes.includes(remote.type)) {
      report.type_warnings.push({
        field_name: mapping.field_name,
        expected_type: mapping.feishu_type,
        remote_type: remote.type,
        remote_type_label: fieldTypeLabel(remote.type),
        accepted_remote_types: acceptedTypes,
      });
    }
  }

  report.ready_for_write = report.missing_fields.length === 0;
  report.status = report.ready_for_write ? "ready_for_write_test" : "missing_fields";
} catch (error) {
  report.status = "failed";
  report.error = {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
  };
}

await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Feishu table fields check written to ${outPath}`);
console.log(`Status: ${report.status}`);
console.log(`Remote fields: ${report.total_remote_fields}`);
console.log(`Missing fields: ${report.missing_fields.length}`);
console.log(`Type warnings: ${report.type_warnings.length}`);

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
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
    const json = await response.json();
    if (!response.ok || json.code !== 0) throw createFeishuError("Failed to list Bitable fields", json);
    fields.push(...(json.data?.items ?? []).map(normalizeRemoteField));
    pageToken = json.data?.has_more ? json.data?.page_token ?? "" : "";
  } while (pageToken);
  return fields;
}

function normalizeRemoteField(field) {
  return {
    ...field,
    field_id: field.field_id ?? field.id ?? "",
    field_name: field.field_name ?? field.name ?? "",
    type: Number(field.type),
  };
}

function acceptedFieldTypes(type) {
  const normalized = type.trim();
  if (normalized === "number") return [2];
  if (normalized === "single_select") return [3];
  if (normalized === "multi_select") return [4];
  if (normalized === "checkbox") return [7];
  if (normalized === "url") return [1, 15];
  if (normalized === "attachment") return [17];
  if (normalized === "text" || normalized === "long_text") return [1];
  return [];
}

function fieldTypeLabel(type) {
  const labels = new Map([
    [1, "Text"],
    [2, "Number"],
    [3, "Single Select"],
    [4, "Multi Select"],
    [5, "Date"],
    [7, "Checkbox"],
    [11, "User"],
    [13, "Phone"],
    [15, "URL"],
    [17, "Attachment"],
    [18, "Single Link"],
    [20, "Formula"],
    [21, "Duplex Link"],
    [22, "Location"],
    [23, "Group Chat"],
    [1001, "Created Time"],
    [1002, "Modified Time"],
    [1003, "Created User"],
    [1004, "Modified User"],
    [1005, "Auto Number"],
  ]);
  return labels.get(Number(type)) ?? "Unknown";
}

function createFeishuError(prefix, responseJson) {
  const error = new Error(`${prefix}: ${JSON.stringify(responseJson)}`);
  error.code = responseJson?.code;
  error.response = responseJson;
  return error;
}
