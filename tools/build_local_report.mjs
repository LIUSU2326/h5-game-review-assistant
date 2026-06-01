import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const gameId = args.gameId ?? args["game-id"] ?? "cow-saver";
const gameDir = path.join(root, "evidence", gameId);

const reportZh = await readJson(path.join(gameDir, "report.zh.json"));
const aiZh = await readJson(path.join(gameDir, "ai_eval.zh.json"));
const aiEn = await readJson(path.join(gameDir, "ai_eval.en.json"));

const zh = aiZh.result ?? {};
const en = aiEn.result ?? {};
const reportPath = path.join(gameDir, "report.html");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(reportZh.game_name)} POC Report</title>
  <style>
    :root {
      --ink: #181d26;
      --body: #333840;
      --muted: #676d78;
      --canvas: #fbfcfd;
      --surface: #ffffff;
      --soft: #f3f6fa;
      --line: #dde2ea;
      --strong: #9297a0;
      --primary: #181d26;
      --blue: #1b61c9;
      --green: #0a6b3d;
      --coral: #aa2d00;
      --amber: #a86400;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--canvas);
      color: var(--ink);
      font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      line-height: 1.45;
    }
    .shell { max-width: 1440px; margin: 0 auto; padding: 32px; }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      align-items: end;
      padding: 28px 0 24px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.12; font-weight: 560; letter-spacing: 0; }
    h2 { margin: 0 0 16px; font-size: 22px; line-height: 1.25; font-weight: 560; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 16px; line-height: 1.3; font-weight: 650; letter-spacing: 0; }
    p { margin: 0; color: var(--body); }
    .meta { color: var(--muted); font-size: 14px; max-width: 78ch; }
    .badge-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      color: var(--body);
      font-size: 13px;
      white-space: nowrap;
    }
    .badge.warn { border-color: #f0c48b; color: var(--amber); background: #fff8ed; }
    .badge.ok { border-color: #a8d8c4; color: var(--green); background: #edf8f3; }
    .grid { display: grid; gap: 20px; margin-top: 24px; }
    .grid.two { grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr); align-items: start; }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 20px;
    }
    .panel.soft { background: var(--soft); }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
    .metric { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
    .metric .label { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .metric .value { font-size: 20px; font-weight: 620; line-height: 1.2; }
    .field-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .field-table th,
    .field-table td { padding: 12px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    .field-table th { color: var(--muted); font-size: 12px; font-weight: 650; background: #f8fafc; }
    .field-table td { font-size: 14px; color: var(--body); }
    .field-table tr:last-child td { border-bottom: 0; }
    .confidence { font-variant-numeric: tabular-nums; color: var(--green); font-weight: 650; }
    .suggestions { color: var(--coral); }
    .screens { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    figure { margin: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); overflow: hidden; }
    figure img { width: 100%; display: block; background: #f2f4f8; }
    figcaption { padding: 10px 12px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); }
    .copy-block {
      white-space: pre-wrap;
      color: var(--body);
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      font-size: 14px;
    }
    ul, ol { margin: 0; padding-left: 20px; color: var(--body); }
    li + li { margin-top: 6px; }
    .footer { margin: 28px 0 8px; color: var(--muted); font-size: 12px; }
    @media (max-width: 980px) {
      .shell { padding: 20px; }
      header, .grid.two, .grid.three, .metrics, .screens { grid-template-columns: 1fr; }
      .badge-row { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>${escapeHtml(reportZh.game_name)} 评测 POC</h1>
        <p class="meta">${escapeHtml(reportZh.url)}</p>
      </div>
      <div class="badge-row">
        <span class="badge ok">${escapeHtml(aiZh.evaluation_source)}</span>
        <span class="badge">后台中文</span>
        <span class="badge">导出英文</span>
        <span class="badge warn">${escapeHtml(zh.sub_type?.needs_taxonomy_review ? "有标签建议" : "无标签建议")}</span>
      </div>
    </header>

    <section class="metrics">
      ${metric("Page Title", reportZh.page_title || "-")}
      ${metric("资源体积估算", `${reportZh.package_size_estimate_mb?.content_length_mb ?? "-"} MB`)}
      ${metric("正常加载", `${reportZh.normal_network_load_ms?.domcontentloaded_ms ?? "-"} ms`)}
      ${metric("Slow 4G", `${reportZh.slow_4g_load_ms?.domcontentloaded_ms ?? "-"} ms`)}
      ${metric("自动试玩", `${playStrategyLabel(reportZh.autoplay?.strategy || reportZh.collection_quality?.play_strategy)} · ${reportZh.collection_quality?.autoplay_action_count ?? 0} 次`)}
    </section>

    <section class="grid two">
      <div class="panel">
        <h2>评测字段</h2>
        <table class="field-table">
          <thead>
            <tr><th style="width: 170px;">字段</th><th>结果</th><th style="width: 100px;">置信度</th></tr>
          </thead>
          <tbody>
            ${fieldRow("适配设备", zh.device_fit?.value, zh.device_fit?.confidence)}
            ${fieldRow("适合人群", selectedZh(zh.audience), zh.audience?.confidence)}
            ${fieldRow("游戏模式", zh.game_mode?.value, zh.game_mode?.confidence)}
            ${fieldRow("游戏类型", selectedZh(zh.game_type), zh.game_type?.confidence)}
            ${fieldRow("细分类型", `${selectedZh(zh.sub_type)}${suggestionText(zh.sub_type)}`, zh.sub_type?.confidence)}
            ${fieldRow("游戏题材", selectedZh(zh.theme), zh.theme?.confidence)}
            ${fieldRow("画风", selectedZh(zh.art_style), zh.art_style?.confidence)}
            ${fieldRow("特色标签", `${selectedZh(zh.feature_tags)}${suggestionText(zh.feature_tags)}`, zh.feature_tags?.confidence)}
            ${fieldRow("横版/竖版", zh.orientation?.value, zh.orientation?.confidence)}
            ${fieldRow("新手引导", zh.tutorial?.value, zh.tutorial?.confidence)}
            ${fieldRow("BGM", zh.bgm?.value, zh.bgm?.confidence)}
            ${fieldRow("自适配", zh.responsive?.value, zh.responsive?.confidence)}
            ${fieldRow("Controls", selectedZh(zh.controls), zh.controls?.confidence)}
          </tbody>
        </table>
      </div>

      <div class="grid">
        <div class="panel soft">
          <h2>How To Play</h2>
          ${list(zh.how_to_play)}
        </div>
        <div class="panel">
          <h2>观察备注</h2>
          ${list(zh.review_notes)}
        </div>
      </div>
    </section>

    <section class="grid two">
      <div class="panel">
        <h2>证据截图</h2>
        <div class="screens">
          ${screenshots(reportZh.screenshots ?? [])}
        </div>
      </div>
      <div class="panel">
        <h2>英文导出摘要</h2>
        <h3>Product Overview</h3>
        <div class="copy-block">${escapeHtml(en.product_overview_150_words ?? "")}</div>
        <div style="height: 16px;"></div>
        <h3>Features</h3>
        ${featureList(en.features)}
      </div>
    </section>

    <section class="grid three">
      <div class="panel">
        <h2>页面信息</h2>
        <p><strong>Title:</strong> ${escapeHtml(reportZh.page_title ?? "")}</p>
        <p><strong>Meta:</strong> ${escapeHtml(reportZh.meta_description || "(empty)")}</p>
        <p><strong>Keywords:</strong> ${escapeHtml(reportZh.keywords ?? "")}</p>
      </div>
      <div class="panel">
        <h2>自动试玩记录</h2>
        ${autoplaySummary(reportZh.autoplay)}
      </div>
      <div class="panel">
        <h2>新增标签建议</h2>
        ${taxonomySuggestions(en.taxonomy_new_suggestions)}
      </div>
      <div class="panel">
        <h2>文件</h2>
        <ul>
          <li>report.zh.json</li>
          <li>report.en.json</li>
          <li>ai_eval.zh.json</li>
          <li>ai_eval.en.json</li>
          <li>ai_request_preview.json</li>
        </ul>
      </div>
    </section>

    <p class="footer">Generated by H5 Game Eval POC. Airtable-inspired internal workbench style.</p>
  </main>
</body>
</html>`;

await fs.writeFile(reportPath, html, "utf8");
console.log(`Local report written to ${reportPath}`);

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metric(label, value) {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function fieldRow(label, value, confidence) {
  const conf = typeof confidence === "number" ? confidence.toFixed(2) : "-";
  return `<tr><td>${escapeHtml(label)}</td><td>${value ?? "-"}</td><td class="confidence">${escapeHtml(conf)}</td></tr>`;
}

function selectedZh(field) {
  const selected = field?.selected ?? [];
  if (!selected.length) return "-";
  return selected.map((item) => escapeHtml(item.name_zh ?? item.name_en ?? item.id)).join("、");
}

function suggestionText(field) {
  const suggestions = field?.new_suggestions ?? [];
  if (!suggestions.length) return "";
  return `<div class="suggestions">建议新增：${suggestions.map(escapeHtml).join("、")}</div>`;
}

function list(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "<p>-</p>";
  return `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function screenshots(items) {
  if (!items.length) return "<p>暂无截图</p>";
  return items
    .map(
      (item) => `<figure><img src="${escapeHtml(item)}" alt="${escapeHtml(item)}" /><figcaption>${escapeHtml(
        item,
      )}</figcaption></figure>`,
    )
    .join("");
}

function featureList(features) {
  const rows = Array.isArray(features) ? features : [];
  if (!rows.length) return "<p>-</p>";
  return `<ul>${rows
    .map((item) => `<li><strong>${escapeHtml(item.title)}</strong>: ${escapeHtml(item.description_30_words)}</li>`)
    .join("")}</ul>`;
}

function taxonomySuggestions(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "<p>暂无新增建议</p>";
  return `<ul>${rows
    .map((item) => `<li><strong>${escapeHtml(item.field)}</strong>: ${escapeHtml(item.suggestion)}<br />${escapeHtml(item.reason)}</li>`)
    .join("")}</ul>`;
}

function autoplaySummary(autoplay) {
  const runs = Array.isArray(autoplay?.runs) ? autoplay.runs : [];
  if (!runs.length) return "<p>暂无自动试玩动作记录。</p>";
  return `<ul>${runs
    .map((run) => `<li><strong>${escapeHtml(run.label || run.id)}</strong>: ${escapeHtml(playStrategyLabel(run.strategy))} · ${escapeHtml(run.action_count ?? 0)} 次动作</li>`)
    .join("")}</ul>`;
}

function playStrategyLabel(value) {
  const labels = {
    passive: "只观察",
    legacy_center_tap: "安全点击",
    guided_probe: "引导探测",
    adaptive_probe: "AI 预留探测",
  };
  return labels[String(value ?? "")] ?? (value || "-");
}
