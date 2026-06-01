import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "feishu.local.json");
const outPath = path.join(root, "config", "taxonomy_from_feishu.json");
const config = await readJsonOrNull(configPath);
const appToken = config?.bitable?.app_token ?? "";
const tableId = config?.bitable?.tables?.taxonomy_options?.table_id ?? "";

const report = {
  synced_at: new Date().toISOString(),
  status: "unknown",
  table_id: isPlaceholder(tableId) ? "" : tableId,
  option_count: 0,
  enabled_count: 0,
  categories: {},
  expected_fields: ["Category", "Option ID", "Parent ID", "Level", "Name EN", "Name ZH", "Enabled", "Description ZH"],
};

try {
  if (!config) throw new Error("Missing config/feishu.local.json.");
  if (!config.app_id || !config.app_secret || !appToken || isPlaceholder(tableId)) {
    report.status = "missing_config";
    report.message = "Fill bitable.tables.taxonomy_options.table_id in config/feishu.local.json after creating/importing the Taxonomy Options table.";
  } else {
    const tenantToken = await getTenantAccessToken(config.app_id, config.app_secret);
    const records = await listRecords(tenantToken, appToken, tableId);
    const categories = {};

    for (const record of records) {
      const fields = record.fields ?? {};
      const category = normalizeText(fields.Category);
      const option = {
        id: normalizeText(fields["Option ID"]),
        parent_id: normalizeText(fields["Parent ID"]),
        level: normalizeText(fields.Level),
        name_en: normalizeText(fields["Name EN"]),
        name_zh: normalizeText(fields["Name ZH"]),
        enabled: normalizeEnabled(fields.Enabled),
        description_zh: normalizeText(fields["Description ZH"]),
        record_id: record.record_id,
      };
      if (!category || !option.id) continue;
      categories[category] ??= [];
      categories[category].push(option);
    }

    report.categories = Object.fromEntries(
      Object.entries(categories).map(([category, options]) => [
        category,
        options.sort((a, b) => `${a.level}:${a.id}`.localeCompare(`${b.level}:${b.id}`)),
      ]),
    );
    report.option_count = Object.values(report.categories).reduce((sum, options) => sum + options.length, 0);
    report.enabled_count = Object.values(report.categories).reduce((sum, options) => sum + options.filter((option) => option.enabled).length, 0);
    report.status = report.option_count ? "synced" : "empty";
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
console.log(`Taxonomy sync report written to ${outPath}`);
console.log(`Status: ${report.status}`);
console.log(`Options: ${report.option_count}`);

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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

async function listRecords(accessToken, configAppToken, configTableId) {
  const records = [];
  let pageToken = "";
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(configAppToken)}/tables/${encodeURIComponent(configTableId)}/records`);
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
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  return !["false", "0", "no", "否", "关闭", "disabled"].includes(text);
}

function isPlaceholder(value) {
  return !value || /后续|tblx+|replace|填写|table/i.test(String(value));
}

function createFeishuError(prefix, responseJson) {
  const error = new Error(`${prefix}: ${JSON.stringify(responseJson)}`);
  error.code = responseJson?.code;
  error.response = responseJson;
  return error;
}
