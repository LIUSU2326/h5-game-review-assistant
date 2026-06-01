import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const url = args.url ?? args.u ?? "";

if (!url) {
  console.log("Usage:");
  console.log("  npm.cmd run poc:feishu:parse-url -- --url \"https://xxx.feishu.cn/base/xxxxxx?table=tblxxxx\"");
  process.exit(1);
}

const parsed = parseBitableUrl(url);
const outPath = path.join(root, "config", "feishu_url_parse_result.json");
await fs.writeFile(outPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

console.log(`Parse result written to ${outPath}`);
console.log(`app_token: ${parsed.app_token || "(not found)"}`);
console.log(`table_id: ${parsed.table_id || "(not found)"}`);

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

function parseBitableUrl(rawUrl) {
  const result = {
    input_url: rawUrl,
    url_type: "unknown",
    wiki_node_token: "",
    app_token: "",
    table_id: "",
    view_id: "",
    needs_wiki_resolution: false,
    notes: [],
  };

  try {
    const parsedUrl = new URL(rawUrl);
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const wikiIndex = pathParts.findIndex((part) => part === "wiki");
    const baseIndex = pathParts.findIndex((part) => part === "base" || part === "bitable");
    if (wikiIndex !== -1 && pathParts[wikiIndex + 1]) {
      result.url_type = "wiki";
      result.wiki_node_token = pathParts[wikiIndex + 1];
      result.needs_wiki_resolution = true;
      result.notes.push("This is a /wiki/ URL. The path token is a wiki node token, not the bitable app_token.");
      result.notes.push("Use npm.cmd run poc:feishu:resolve-wiki after filling config/feishu.local.json to resolve obj_token as app_token.");
    }
    if (baseIndex !== -1 && pathParts[baseIndex + 1]) {
      result.url_type = "base";
      result.app_token = pathParts[baseIndex + 1];
    }
    result.table_id = parsedUrl.searchParams.get("table") ?? parsedUrl.searchParams.get("table_id") ?? "";
    result.view_id = parsedUrl.searchParams.get("view") ?? parsedUrl.searchParams.get("view_id") ?? "";

    if (!result.app_token && !result.needs_wiki_resolution) result.notes.push("Could not find app_token after /base/ in the URL.");
    if (!result.table_id) result.notes.push("Could not find table id in ?table=... query parameter.");
  } catch (error) {
    result.notes.push(`Invalid URL: ${error.message}`);
  }

  return result;
}
