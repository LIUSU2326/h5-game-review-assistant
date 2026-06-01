import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const mockDir = path.join(root, "mock_bitable");
const outPath = path.join(mockDir, "taxonomy_options_seed.csv");

const sources = [
  { category: "gameplay_types", file: "gameplay_types.csv" },
  { category: "themes", file: "themes.csv" },
  { category: "art_styles", file: "art_styles.csv" },
  { category: "feature_tags", file: "feature_tags.csv" },
  { category: "audiences", file: "audiences.csv" },
  { category: "controls", file: "controls.csv" },
];

const rows = [];
for (const source of sources) {
  const records = await readCsv(path.join(mockDir, source.file));
  for (const record of records) {
    rows.push({
      Category: source.category,
      "Option ID": record.id,
      "Parent ID": record.parent_id ?? "",
      Level: record.level ?? "",
      "Name EN": record.name_en ?? "",
      "Name ZH": record.name_zh ?? "",
      Enabled: record.enabled ?? "true",
      "Description ZH": record.description_zh ?? "",
      "Source File": source.file,
    });
  }
}

const headers = ["Category", "Option ID", "Parent ID", "Level", "Name EN", "Name ZH", "Enabled", "Description ZH", "Source File"];
const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n");
await fs.writeFile(outPath, `${csv}\n`, "utf8");
console.log(`Taxonomy seed CSV written to ${outPath}`);
console.log(`Rows: ${rows.length}`);

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

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
