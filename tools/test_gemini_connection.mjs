import fs from "node:fs/promises";
import path from "node:path";
import { geminiFetch, proxyStatus } from "./lib/gemini_http.mjs";

const root = process.cwd();
const env = await loadEnv(path.join(root, ".env"));
const model = env.GEMINI_MODEL || "gemini-2.5-flash";
const apiKey = env.GEMINI_API_KEY || "";
const timeoutMs = Number(env.GEMINI_TIMEOUT_MS || 60000);
const outPath = path.join(root, "config", "gemini_connection_check.json");

if (!apiKey) {
  await writeReport({
    status: "missing_api_key",
    model,
    message: "GEMINI_API_KEY is empty. Fill .env before testing Gemini.",
  });
  process.exitCode = 1;
} else {
  try {
    const startedAt = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await geminiFetch(endpoint, {
      env,
      timeoutMs,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: "Return only this JSON: {\"ok\":true}" }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      await writeReport({
        status: "api_error",
        model,
        proxy: proxyStatus(env),
        http_status: response.status,
        elapsed_ms: Date.now() - startedAt,
        response_body: safeBody(body),
      });
      process.exitCode = 1;
    } else {
      await writeReport({
        status: "ok",
        model,
        proxy: proxyStatus(env),
        elapsed_ms: Date.now() - startedAt,
        response_body: safeBody(body),
      });
    }
  } catch (error) {
    await writeReport({
      status: "network_error",
      model,
      proxy: proxyStatus(env),
      error: {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        code: error?.cause?.code,
      },
      likely_fix: "Ensure this computer can reach generativelanguage.googleapis.com, or set GEMINI_PROXY / HTTPS_PROXY in .env to a proxy that can access Gemini API.",
    });
    process.exitCode = 1;
  }
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const fullReport = {
    checked_at: new Date().toISOString(),
    ...report,
  };
  await fs.writeFile(outPath, `${JSON.stringify(fullReport, null, 2)}\n`, "utf8");
  console.log(`Gemini connection check written to ${outPath}`);
  console.log(`Status: ${fullReport.status}`);
}

async function loadEnv(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function safeBody(text) {
  if (!text) return "";
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}
