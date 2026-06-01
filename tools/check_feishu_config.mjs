import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "feishu.local.json");
const examplePath = path.join(root, "config", "feishu.example.json");
const mappingPath = path.join(root, "mock_bitable", "feishu_field_mapping.csv");
const parsedUrlPath = path.join(root, "config", "feishu_url_parse_result.json");
const wikiResolveResultPath = path.join(root, "config", "feishu_wiki_resolve_result.json");

const config = (await readJsonOrNull(configPath)) ?? (await readJsonOrNull(examplePath));
const usingExample = !(await fileExists(configPath));
const mapping = await readTextOrNull(mappingPath);
const parsedUrl = await readJsonOrNull(parsedUrlPath);
const wikiResolveResult = await readJsonOrNull(wikiResolveResultPath);
const diagnostics = [];

if (usingExample) {
  diagnostics.push({
    level: "info",
    item: "config",
    message: "config/feishu.local.json not found. Using config/feishu.example.json for shape validation only.",
  });
}

requiredString(config, "app_id", "Feishu App ID");
requiredString(config, "app_secret", "Feishu App Secret");
requiredAppToken(config, parsedUrl);
checkWikiPermission(wikiResolveResult);
requiredString(config, "bitable.tables.evaluation_results.table_id", "Evaluation results Table ID");
optionalString(config, "bitable.tables.taxonomy_suggestions.table_id", "Taxonomy suggestions Table ID");

if (!mapping) {
  diagnostics.push({
    level: "error",
    item: "field_mapping",
    message: "mock_bitable/feishu_field_mapping.csv is missing.",
  });
} else {
  const firstLine = mapping.split(/\r?\n/)[0] ?? "";
  const requiredHeaders = ["field_name", "source_path", "feishu_type", "required"];
  for (const header of requiredHeaders) {
    if (!firstLine.split(",").includes(header)) {
      diagnostics.push({
        level: "error",
        item: "field_mapping",
        message: `Missing required header: ${header}`,
      });
    }
  }
}

const hasError = diagnostics.some((item) => item.level === "error");
const report = {
  checked_at: new Date().toISOString(),
  using_example_config: usingExample,
  status: hasError ? "invalid" : usingExample ? "template_ready" : "ready_for_connection_test",
  diagnostics,
  next_steps: usingExample
    ? [
        "Copy config/feishu.example.json to config/feishu.local.json.",
        "Fill app_id, app_secret, bitable.app_token, and table IDs.",
        "Run npm.cmd run poc:feishu:check again.",
      ]
    : [
        "Run a Feishu token request and table metadata read in the next integration step.",
        "Compare Feishu field names with mock_bitable/feishu_field_mapping.csv.",
      ],
};

const outPath = path.join(root, "config", "feishu_config_check.json");
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Feishu config check written to ${outPath}`);
console.log(`Status: ${report.status}`);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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

function getPath(source, sourcePath) {
  return sourcePath.split(".").reduce((value, key) => {
    if (value == null) return undefined;
    return value[key];
  }, source);
}

function requiredString(source, sourcePath, label) {
  const value = getPath(source, sourcePath);
  if (isPlaceholder(value)) {
    diagnostics.push({
      level: usingExample ? "todo" : "error",
      item: sourcePath,
      message: `${label} is missing or still uses a placeholder.`,
    });
  }
}

function optionalString(source, sourcePath, label) {
  const value = getPath(source, sourcePath);
  if (isPlaceholder(value)) {
    diagnostics.push({
      level: "todo",
      item: sourcePath,
      message: `${label} is optional for the first write test and can be configured later.`,
    });
  }
}

function checkWikiPermission(resolveResult) {
  if (resolveResult?.status !== "missing_permission") return;
  diagnostics.push({
    level: "error",
    item: "wiki_permission",
    message: "The latest wiki resolve attempt failed because the Feishu app lacks wiki:node:read or wiki:wiki:readonly. Add the permission, publish a new version, then run npm.cmd run poc:feishu:resolve-wiki again.",
  });
}

function requiredAppToken(source, urlParseResult) {
  const value = getPath(source, "bitable.app_token");
  if (!isPlaceholder(value)) return;
  if (urlParseResult?.needs_wiki_resolution) {
    diagnostics.push({
      level: "todo",
      item: "bitable.app_token",
      message: "Bitable App Token is empty because the URL is a /wiki/ link. Run npm.cmd run poc:feishu:resolve-wiki after filling app_secret. If Feishu returns 99991672, add wiki:node:read or wiki:wiki:readonly permission, publish a new version, then retry.",
    });
    return;
  }
  diagnostics.push({
    level: usingExample ? "todo" : "error",
    item: "bitable.app_token",
    message: "Bitable App Token is missing or still uses a placeholder.",
  });
}

function isPlaceholder(value) {
  return (
    typeof value !== "string" ||
    !value.trim() ||
    /在这里填写|replace_with|xxxxxxxx|app secret|base 链接|wiki 链接|从多维表格/i.test(value)
  );
}
