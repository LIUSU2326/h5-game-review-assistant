import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const configPath = path.join(root, "config", "feishu.local.json");
const parseResultPath = path.join(root, "config", "feishu_url_parse_result.json");
const outPath = path.join(root, "config", "feishu_wiki_resolve_result.json");

const config = await readJson(configPath, "Missing config/feishu.local.json. Copy config/feishu.local.template.json and fill app_id/app_secret first.");
const parsedUrl = await readJson(parseResultPath, "Missing config/feishu_url_parse_result.json. Run poc:feishu:parse-url first.");
const wikiNodeToken = args.token ?? parsedUrl.wiki_node_token;
const shouldWriteConfig = args["write-config"] !== "false";

if (!wikiNodeToken) {
  throw new Error("No wiki node token found. Provide --token or run poc:feishu:parse-url with a /wiki/ URL first.");
}

const startedAt = Date.now();
const report = {
  checked_at: new Date().toISOString(),
  wiki_node_token: wikiNodeToken,
  table_id_from_url: parsedUrl.table_id ?? "",
  view_id_from_url: parsedUrl.view_id ?? "",
  status: "unknown",
  app_token: "",
  config_updated: false,
  node: null,
  elapsed_ms: 0,
};

try {
  const tenantToken = await getTenantAccessToken(config.app_id, config.app_secret);
  const node = await getWikiNode(tenantToken, wikiNodeToken);
  report.node = node;
  if (node?.obj_type !== "bitable") {
    report.status = "not_bitable";
    report.message = `Resolved wiki node obj_type is ${node?.obj_type ?? "unknown"}, expected bitable.`;
  } else {
    report.status = "resolved";
    report.app_token = node.obj_token;
    if (shouldWriteConfig) {
      await updateLocalConfig(config, parsedUrl, node.obj_token);
      report.config_updated = true;
      report.message = "Resolved app_token and updated config/feishu.local.json.";
    } else {
      report.message = "Resolved app_token. Re-run without --write-config false to update config/feishu.local.json automatically.";
    }
  }
} catch (error) {
  report.status = error?.code === 99991672 || /99991672/.test(error?.message ?? "") ? "missing_permission" : "failed";
  if (report.status === "missing_permission") {
    report.message = "The Feishu app is missing Wiki node read permission. Add wiki:node:read or wiki:wiki:readonly, publish a new app version, then run this command again.";
    report.required_scopes = ["wiki:node:read", "wiki:wiki:readonly", "wiki:wiki"];
  }
  report.error = {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code ?? error?.cause?.code,
    permission_violations: error?.response?.error?.permission_violations ?? [],
  };
}

report.elapsed_ms = Date.now() - startedAt;
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wiki resolve result written to ${outPath}`);
console.log(`Status: ${report.status}`);
if (report.app_token) console.log(`app_token: resolved${report.config_updated ? " and written to config/feishu.local.json" : ""}`);
if (report.table_id_from_url) console.log(`table_id: ${report.table_id_from_url}`);

function parseArgs(rawArgs) {
  const parsedArgs = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsedArgs[key] = true;
    } else {
      parsedArgs[key] = next;
      i += 1;
    }
  }
  return parsedArgs;
}

async function readJson(filePath, missingMessage) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error(missingMessage);
  }
}

async function updateLocalConfig(sourceConfig, parsedResult, appToken) {
  const nextConfig = JSON.parse(JSON.stringify(sourceConfig));
  nextConfig.bitable ??= {};
  nextConfig.bitable.app_token = appToken;
  nextConfig.bitable.tables ??= {};
  nextConfig.bitable.tables.evaluation_results ??= {};
  if (parsedResult.table_id) nextConfig.bitable.tables.evaluation_results.table_id = parsedResult.table_id;
  if (parsedResult.view_id) nextConfig.bitable.tables.evaluation_results.view_id = parsedResult.view_id;
  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}

async function getTenantAccessToken(appId, appSecret) {
  if (!appId || !appSecret || /在这里填写|replace_with|xxxxxxxx/i.test(`${appId} ${appSecret}`)) {
    throw new Error("app_id or app_secret is missing in config/feishu.local.json.");
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw createFeishuError("Failed to get tenant_access_token", json);
  }
  return json.tenant_access_token;
}

async function getWikiNode(accessToken, token) {
  const url = new URL("https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node");
  url.searchParams.set("token", token);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw createFeishuError("Failed to resolve wiki node", json);
  }
  return json.data?.node ?? null;
}

function createFeishuError(prefix, responseJson) {
  const error = new Error(`${prefix}: ${JSON.stringify(responseJson)}`);
  error.code = responseJson?.code;
  error.response = responseJson;
  return error;
}
