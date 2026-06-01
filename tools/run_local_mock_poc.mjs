import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const mockDir = path.join(root, "mock_bitable");
const sampleFile = path.join(root, "samples", "games.csv");
const evidenceRoot = path.join(root, "evidence");

function parseCsv(text) {
  const rows = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = rows.shift().split(",");
  return rows.filter(Boolean).map((row) => {
    const values = row.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function readCsv(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return parseCsv(text);
}

function enabledOptions(rows) {
  return rows
    .filter((row) => row.enabled === "true")
    .map((row) => ({
      id: row.id,
      name_en: row.name_en,
      name_zh: row.name_zh,
      description_zh: row.description_zh,
    }));
}

const games = await readCsv(sampleFile);
const outputFields = await readCsv(path.join(mockDir, "output_fields.csv"));
const taxonomies = {
  gameplay_types: enabledOptions(await readCsv(path.join(mockDir, "gameplay_types.csv"))),
  themes: enabledOptions(await readCsv(path.join(mockDir, "themes.csv"))),
  art_styles: enabledOptions(await readCsv(path.join(mockDir, "art_styles.csv"))),
  feature_tags: enabledOptions(await readCsv(path.join(mockDir, "feature_tags.csv"))),
  audiences: enabledOptions(await readCsv(path.join(mockDir, "audiences.csv"))),
  controls: enabledOptions(await readCsv(path.join(mockDir, "controls.csv"))),
};

for (const game of games) {
  const gameDir = path.join(evidenceRoot, game.game_id);
  for (const subdir of ["screenshots", "video", "network", "traces"]) {
    await fs.mkdir(path.join(gameDir, subdir), { recursive: true });
  }

  const zhReport = {
    game_id: game.game_id,
    game_name: game.game_name,
    url: game.url,
    status: "mock_ready",
    note: "本报告由本地模拟多维表格生成，尚未执行浏览器自动化采集。",
    backend_language: "zh",
    export_language: "en",
    field_count: outputFields.length,
    taxonomy_tables: Object.fromEntries(
      Object.entries(taxonomies).map(([key, rows]) => [key, rows.length]),
    ),
    sample_field_strategy: {
      game_type: {
        source_table: "gameplay_types",
        selection_rule: "AI 优先从 enabled=true 的选项中选择；不匹配时输出新增建议。",
      },
      controls: {
        source_table: "controls",
        selection_rule: "可多选，后续由截图/OCR/试玩动作共同判断。",
      },
    },
  };

  const enReport = {
    game_id: game.game_id,
    game_name: game.game_name,
    url: game.url,
    status: "mock_ready",
    note: "This report was generated from local mock Bitable configuration. Browser automation has not run yet.",
    backend_language: "zh",
    export_language: "en",
    field_count: outputFields.length,
    taxonomy_tables: Object.fromEntries(
      Object.entries(taxonomies).map(([key, rows]) => [key, rows.length]),
    ),
    next_step: "Run the Playwright POC to collect screenshots, network timings, page metadata, and evidence files.",
  };

  await fs.writeFile(path.join(gameDir, "report.zh.json"), `${JSON.stringify(zhReport, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(gameDir, "report.en.json"), `${JSON.stringify(enReport, null, 2)}\n`, "utf8");
}

console.log(`Created mock evidence for ${games.length} game(s) in ${evidenceRoot}`);
