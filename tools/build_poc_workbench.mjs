import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const evidenceRoot = path.join(root, "evidence");
const workbenchDir = path.join(root, "workbench");
await fs.mkdir(workbenchDir, { recursive: true });

const gameDirs = (await fs.readdir(evidenceRoot, { withFileTypes: true })).filter((item) => item.isDirectory());
const games = [];

for (const dir of gameDirs) {
  const gameDir = path.join(evidenceRoot, dir.name);
  const collection = await readJsonOrNull(path.join(gameDir, "report.zh.json"));
  const aiZh = await readJsonOrNull(path.join(gameDir, "ai_eval.zh.json"));
  const aiEn = await readJsonOrNull(path.join(gameDir, "ai_eval.en.json"));
  const feishu = await readJsonOrNull(path.join(gameDir, "feishu_payload_preview.json"));
  const feishuWrite = await readJsonOrNull(path.join(gameDir, "feishu_write_result.json"));
  if (!collection) continue;
  games.push({
    id: dir.name,
    gameDir,
    collection,
    aiZh,
    aiEn,
    feishu,
    feishuWrite,
  });
}

const active = games[0];
if (!active) {
  throw new Error("No evidence game folders found. Run poc:playwright first.");
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>H5 Game Eval POC Workbench</title>
  <style>
    :root {
      --ink: #181d26;
      --body: #333840;
      --muted: #69707d;
      --line: #dde2ea;
      --line-strong: #9297a0;
      --canvas: #fbfcfd;
      --surface: #ffffff;
      --soft: #f6f8fb;
      --soft-2: #edf2f7;
      --primary: #181d26;
      --blue: #1b61c9;
      --green: #006400;
      --coral: #aa2d00;
      --peach: #fcab79;
      --cream: #f5e9d4;
      --mint: #a8d8c4;
      --yellow: #f4d35e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--canvas);
      color: var(--ink);
      font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.4;
    }
    button, input, select { font: inherit; }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background: var(--surface);
      padding: 20px 16px;
      position: sticky;
      top: 0;
      height: 100vh;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 26px;
    }
    .mark {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--primary);
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 700;
      letter-spacing: 0;
    }
    .brand-title { font-weight: 650; font-size: 15px; }
    .brand-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .nav-label {
      margin: 18px 0 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }
    .nav-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 9px 10px;
      border-radius: 8px;
      color: var(--body);
    }
    .nav-item.active { background: var(--soft); color: var(--ink); font-weight: 600; }
    .count { color: var(--muted); font-size: 12px; }
    .main { min-width: 0; }
    .topbar {
      height: 64px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 28px;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .topbar h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 560;
      letter-spacing: 0;
    }
    .top-actions { display: flex; gap: 10px; align-items: center; }
    .btn {
      min-height: 36px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      padding: 8px 13px;
      font-weight: 560;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn.primary { background: var(--primary); color: #fff; border-color: var(--primary); }
    .content {
      padding: 24px 28px 40px;
      display: grid;
      gap: 20px;
    }
    .summary-band {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 18px;
      align-items: stretch;
    }
    .intro {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 20px;
    }
    .eyebrow { color: var(--muted); font-size: 12px; font-weight: 650; margin-bottom: 8px; }
    .game-title { margin: 0 0 8px; font-size: 28px; line-height: 1.16; font-weight: 560; }
    .url { color: var(--muted); word-break: break-all; }
    .status-panel {
      background: var(--primary);
      color: #fff;
      border-radius: 10px;
      padding: 18px;
      display: grid;
      align-content: space-between;
      min-height: 160px;
    }
    .status-panel .big { font-size: 30px; font-weight: 650; line-height: 1.1; }
    .status-panel .small { color: #dce2ea; font-size: 13px; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 14px;
      min-height: 92px;
    }
    .metric-label { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .metric-value { font-size: 19px; font-weight: 650; line-height: 1.2; }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(380px, 0.95fr);
      gap: 20px;
      align-items: start;
    }
    .surface {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .section-head h2 { margin: 0; font-size: 17px; font-weight: 620; }
    .section-note { color: var(--muted); font-size: 12px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: var(--soft); color: var(--muted); font-size: 12px; font-weight: 650; }
    td { color: var(--body); }
    tr:last-child td { border-bottom: 0; }
    .confidence { color: var(--green); font-weight: 650; font-variant-numeric: tabular-nums; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      min-height: 26px;
      padding: 4px 9px;
      background: var(--soft);
      color: var(--body);
      font-size: 12px;
    }
    .tag.review { background: #fff5ed; border-color: #f0c49c; color: var(--coral); }
    .screens {
      padding: 16px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    figure {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: var(--soft);
    }
    figure img { width: 100%; display: block; aspect-ratio: 16 / 10; object-fit: cover; object-position: top center; }
    figcaption { border-top: 1px solid var(--line); padding: 8px 10px; color: var(--muted); font-size: 12px; }
    .copy {
      padding: 16px 18px;
      display: grid;
      gap: 14px;
      color: var(--body);
    }
    .copy h3 { margin: 0 0 6px; font-size: 14px; }
    .copy p { margin: 0; color: var(--body); }
    .copy ul { margin: 0; padding-left: 20px; }
    .copy li + li { margin-top: 6px; }
    .queue {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
    }
    .queue-row {
      display: grid;
      grid-template-columns: 130px minmax(0, 1fr) 110px 110px 130px;
      gap: 12px;
      padding: 12px 14px;
      border-top: 1px solid var(--line);
      align-items: center;
    }
    .queue-head { background: var(--soft); color: var(--muted); font-size: 12px; font-weight: 650; border-top: 0; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 1100px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .summary-band, .layout, .metrics { grid-template-columns: 1fr; }
      .screens { grid-template-columns: 1fr; }
      .queue-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="mark">H5</div>
        <div>
          <div class="brand-title">Game Eval POC</div>
          <div class="brand-sub">自动采集与评测工作台</div>
        </div>
      </div>
      <div class="nav-label">工作流</div>
      <div class="nav-item active"><span>任务概览</span><span class="count">${games.length}</span></div>
      <div class="nav-item"><span>证据截图</span><span class="count">${screenshotCount(active)}</span></div>
      <div class="nav-item"><span>字段复核</span><span class="count">${needsReview(active) ? 1 : 0}</span></div>
      <div class="nav-item"><span>飞书写入</span><span class="count">${feishuWriteStatus(active)}</span></div>
      <div class="nav-label">配置</div>
      <div class="nav-item"><span>模型配置</span><span class="count">预留</span></div>
      <div class="nav-item"><span>标签库</span><span class="count">CSV</span></div>
      <div class="nav-item"><span>飞书连接</span><span class="count">向导</span></div>
    </aside>
    <main class="main">
      <div class="topbar">
        <h1>POC 工作台</h1>
        <div class="top-actions">
          <a class="btn" href="../evidence/${encodeURIComponent(active.id)}/report.html">打开报告</a>
          <a class="btn primary" href="../evidence/${encodeURIComponent(active.id)}/feishu_payload_preview.json">飞书 Payload</a>
        </div>
      </div>
      <div class="content">
        <section class="summary-band">
          <div class="intro">
            <div class="eyebrow">当前样本</div>
            <h2 class="game-title">${escapeHtml(active.collection.game_name)}</h2>
            <div class="url">${escapeHtml(active.collection.url)}</div>
            <div style="height: 14px;"></div>
            <div class="tag-list">
              ${tag(active.collection.status, "ok")}
              ${tag(active.aiZh?.evaluation_source ?? "no_ai")}
              ${tag(needsReview(active) ? "需要标签复核" : "无需标签复核", needsReview(active) ? "review" : "")}
            </div>
          </div>
          <div class="status-panel">
            <div>
              <div class="small">Feishu Write</div>
              <div class="big">${escapeHtml(feishuWriteStatus(active))}</div>
            </div>
            <div class="small">${escapeHtml(feishuWriteCaption(active))}</div>
          </div>
        </section>

        <section class="metrics">
          ${metric("Page Title", active.collection.page_title)}
          ${metric("资源体积", `${active.collection.package_size_estimate_mb?.content_length_mb ?? "-"} MB`)}
          ${metric("正常 DOMContentLoaded", `${active.collection.normal_network_load_ms?.domcontentloaded_ms ?? "-"} ms`)}
          ${metric("Slow 4G DOMContentLoaded", `${active.collection.slow_4g_load_ms?.domcontentloaded_ms ?? "-"} ms`)}
          ${metric("失败请求", active.collection.package_size_estimate_mb?.failed_request_count ?? "-")}
        </section>

        <section class="layout">
          <div class="surface">
            <div class="section-head">
              <h2>评测字段</h2>
              <div class="section-note">后台中文字段，导出英文结果已生成</div>
            </div>
            <table>
              <thead><tr><th style="width: 150px;">字段</th><th>结果</th><th style="width: 90px;">置信度</th></tr></thead>
              <tbody>${fieldRows(active)}</tbody>
            </table>
          </div>
          <div class="surface">
            <div class="section-head">
              <h2>证据截图</h2>
              <div class="section-note">${screenshotCount(active)} 张</div>
            </div>
            <div class="screens">${screenshotFigures(active)}</div>
          </div>
        </section>

        <section class="layout">
          <div class="surface">
            <div class="section-head">
              <h2>英文导出内容</h2>
              <div class="section-note">将用于飞书写入和 Excel 导出</div>
            </div>
            <div class="copy">
              <div><h3>Product Overview</h3><p>${escapeHtml(active.aiEn?.result?.product_overview_150_words ?? "")}</p></div>
              <div><h3>How To Play</h3>${list(active.aiEn?.result?.how_to_play)}</div>
              <div><h3>FAQ</h3>${faq(active.aiEn?.result?.faq)}</div>
            </div>
          </div>
          <div class="surface">
            <div class="section-head">
              <h2>新增标签建议</h2>
              <div class="section-note">后续写入待审核表</div>
            </div>
            <div class="copy">${suggestions(active.aiEn?.result?.taxonomy_new_suggestions)}</div>
          </div>
        </section>

        <section class="surface">
          <div class="section-head">
            <h2>飞书接入向导</h2>
            <div class="section-note">给首次配置的使用者</div>
          </div>
          <div class="copy">
            <div class="tag-list">
              ${tag("1 创建自建应用")}
              ${tag("2 开通多维表格权限")}
              ${tag("3 Wiki 权限")}
              ${tag("4 发布版本")}
              ${tag("5 添加文档应用")}
              ${tag("6 解析 URL")}
              ${tag("7 标签库同步")}
              ${tag("8 写入预览")}
            </div>
            <p>完整步骤已经整理成文档，避免使用者卡在 App ID、App Secret、wiki 链接、Wiki 权限和文档应用授权这些细节上。</p>
            <p>如果多维表格链接是 /wiki/ 开头，需要额外开通 wiki:node:read 或 wiki:wiki:readonly，并重新发布应用版本。</p>
            <p>玩法、题材、画风、特色标签等选项可维护在飞书 Taxonomy Options 表里，再由工具同步给 AI 使用。</p>
            <p><a class="btn" href="../docs/飞书接入用户操作指南.md">打开飞书接入用户操作指南</a></p>
          </div>
        </section>

        <section class="queue">
          <div class="section-head">
            <h2>任务列表</h2>
            <div class="section-note">后续批量导入会扩展这里</div>
          </div>
          <div class="queue-row queue-head"><div>ID</div><div>URL</div><div>状态</div><div>评测源</div><div>飞书写入</div></div>
          ${games.map(queueRow).join("")}
        </section>
      </div>
    </main>
  </div>
</body>
</html>`;

const outPath = path.join(workbenchDir, "index.html");
await fs.writeFile(outPath, html, "utf8");
console.log(`POC workbench written to ${outPath}`);

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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
  return `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value ?? "-")}</div></div>`;
}

function tag(value, tone = "") {
  return `<span class="tag ${tone}">${escapeHtml(value)}</span>`;
}

function screenshotCount(game) {
  return game.collection.screenshots?.length ?? 0;
}

function needsReview(game) {
  return Boolean(game.feishu?.record?.fields?.["Needs Taxonomy Review"]);
}

function feishuWriteStatus(game) {
  return game.feishuWrite?.status ?? game.feishu?.status ?? "missing";
}

function feishuWriteCaption(game) {
  if (game.feishuWrite?.record_id) return `已写入飞书多维表格，Record ID: ${game.feishuWrite.record_id}`;
  if (game.feishuWrite?.status) return `飞书写入状态：${game.feishuWrite.status}`;
  return "已生成写入预览，接入飞书配置后可写入真实多维表格。";
}

function confidence(value) {
  return typeof value === "number" ? value.toFixed(2) : "-";
}

function selectedZh(field) {
  const selected = field?.selected ?? [];
  if (!selected.length) return "-";
  return selected.map((item) => escapeHtml(item.name_zh ?? item.name_en ?? item.id)).join("、");
}

function fieldRows(game) {
  const zh = game.aiZh?.result ?? {};
  const rows = [
    ["适配设备", zh.device_fit?.value, zh.device_fit?.confidence],
    ["适合人群", selectedZh(zh.audience), zh.audience?.confidence],
    ["游戏模式", zh.game_mode?.value, zh.game_mode?.confidence],
    ["游戏类型", selectedZh(zh.game_type), zh.game_type?.confidence],
    ["细分类型", appendReview(selectedZh(zh.sub_type), zh.sub_type?.new_suggestions), zh.sub_type?.confidence],
    ["游戏题材", selectedZh(zh.theme), zh.theme?.confidence],
    ["画风", selectedZh(zh.art_style), zh.art_style?.confidence],
    ["特色标签", appendReview(selectedZh(zh.feature_tags), zh.feature_tags?.new_suggestions), zh.feature_tags?.confidence],
    ["横版/竖版", zh.orientation?.value, zh.orientation?.confidence],
    ["新手引导", zh.tutorial?.value, zh.tutorial?.confidence],
    ["BGM", zh.bgm?.value, zh.bgm?.confidence],
    ["自适配", zh.responsive?.value, zh.responsive?.confidence],
    ["Controls", selectedZh(zh.controls), zh.controls?.confidence],
  ];
  return rows
    .map(([label, value, conf]) => `<tr><td>${escapeHtml(label)}</td><td>${value ?? "-"}</td><td class="confidence">${confidence(conf)}</td></tr>`)
    .join("");
}

function appendReview(value, suggestions) {
  if (!suggestions?.length) return value;
  return `${value}<div style="margin-top: 6px;">${suggestions.map((item) => tag(`建议：${item}`, "review")).join("")}</div>`;
}

function screenshotFigures(game) {
  return (game.collection.screenshots ?? [])
    .map((relative) => {
      const src = `../evidence/${encodeURIComponent(game.id)}/${relative}`;
      return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(relative)}"><figcaption>${escapeHtml(relative)}</figcaption></figure>`;
    })
    .join("");
}

function list(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "<p>-</p>";
  return `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function faq(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "<p>-</p>";
  return `<ul>${rows.map((item) => `<li><strong>${escapeHtml(item.question)}</strong><br>${escapeHtml(item.answer)}</li>`).join("")}</ul>`;
}

function suggestions(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "<p>暂无新增建议</p>";
  return `<ul>${rows.map((item) => `<li><strong>${escapeHtml(item.field)}:</strong> ${escapeHtml(item.suggestion)}<br>${escapeHtml(item.reason)}</li>`).join("")}</ul>`;
}

function queueRow(game) {
  return `<div class="queue-row">
    <div>${escapeHtml(game.id)}</div>
    <div class="truncate">${escapeHtml(game.collection.url)}</div>
    <div>${escapeHtml(game.collection.status)}</div>
    <div>${escapeHtml(game.aiZh?.evaluation_source ?? "missing")}</div>
    <div>${escapeHtml(feishuWriteStatus(game))}</div>
  </div>`;
}
