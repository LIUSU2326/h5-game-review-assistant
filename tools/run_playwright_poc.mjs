import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { chromium, devices } from "playwright-core";

const root = process.cwd();
const sampleFile = path.join(root, "samples", "games.csv");
const evidenceRoot = path.join(root, "evidence");
const defaultBrowserPath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const args = parseArgs(process.argv.slice(2));
const targetGameId = args.gameId ?? args["game-id"] ?? "cow-saver";
const playSeconds = Number(args.playSeconds ?? args["play-seconds"] ?? 60);
const headless = args.headed ? false : true;
const traceMode = String(args.trace ?? "off").toLowerCase();
const navigationTimeoutMs = Number(args.navigationTimeoutMs ?? args["navigation-timeout-ms"] ?? 45000);
const networkIdleTimeoutMs = Number(args.networkIdleTimeoutMs ?? args["networkidle-timeout-ms"] ?? 10000);
const screenshotTimeoutMs = Number(args.screenshotTimeoutMs ?? args["screenshot-timeout-ms"] ?? 30000);
const traceStopTimeoutMs = Number(args.traceStopTimeoutMs ?? args["trace-stop-timeout-ms"] ?? 15000);
const failOnPartial = Boolean(args["fail-on-partial"]);
const recordVideo = Boolean(args["record-video"]);
const videoSeconds = Math.max(0, Number(args.videoSeconds ?? args["video-seconds"] ?? (recordVideo ? 15 : 0)));
const playStrategy = normalizePlayStrategy(args.playStrategy ?? args["play-strategy"] ?? "legacy_center_tap");
const actionLogLimit = Math.max(20, Number(args.actionLogLimit ?? args["action-log-limit"] ?? 80));

const slow4g = {
  offline: false,
  latency: 400,
  downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
  uploadThroughput: Math.floor((750 * 1024) / 8),
};

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

function normalizePlayStrategy(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["passive", "legacy_center_tap", "guided_probe", "adaptive_probe"].includes(normalized)) return normalized;
  if (["legacy", "center", "center_tap"].includes(normalized)) return "legacy_center_tap";
  if (["smart", "probe", "ai_probe", "guided"].includes(normalized)) return "guided_probe";
  if (["adaptive", "agent", "ai_player", "agent_probe", "vision_ready"].includes(normalized)) return "adaptive_probe";
  return "legacy_center_tap";
}

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

async function ensureDirs(gameDir) {
  for (const subdir of ["screenshots", "video", "network", "traces"]) {
    await fs.mkdir(path.join(gameDir, subdir), { recursive: true });
  }
}

async function resetCollectionArtifacts(gameDir) {
  for (const subdir of ["screenshots", "video", "network", "traces"]) {
    await fs.rm(path.join(gameDir, subdir), { recursive: true, force: true });
  }
  await ensureDirs(gameDir);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
  };
}

function bytesToMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function getGameSlug(game) {
  try {
    const match = new URL(game.url).pathname.match(/\/game\/([^/]+)/i);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactToken(value) {
  return normalizeToken(value).replace(/\s+/g, "");
}

function validateTargetPage(game, pageInfo) {
  const slug = getGameSlug(game);
  const slugWords = normalizeToken(slug);
  const slugCompact = compactToken(slug);
  const nameWords = normalizeToken(game.game_name);
  const nameCompact = compactToken(game.game_name);
  const finalUrl = String(pageInfo?.url ?? "");
  const canonical = String(pageInfo?.canonical ?? "");
  const title = normalizeToken(pageInfo?.title);
  const keywords = normalizeToken(pageInfo?.keywords);
  const urlHaystack = `${finalUrl} ${canonical}`.toLowerCase();

  const urlMatches = Boolean(slug && /\/game\//i.test(urlHaystack) && urlHaystack.includes(`/game/${slug.toLowerCase()}/`));
  const titleMatches = Boolean(nameCompact && compactToken(title).includes(nameCompact)) ||
    Boolean(slugCompact && compactToken(title).includes(slugCompact));
  const keywordMatches = Boolean(nameCompact && compactToken(keywords).includes(nameCompact)) ||
    Boolean(slugCompact && compactToken(keywords).includes(slugCompact));

  return {
    expected_slug: slug,
    expected_name: game.game_name,
    matches: urlMatches || titleMatches || keywordMatches,
    signals: {
      url_matches: urlMatches,
      title_matches: titleMatches,
      keyword_matches: keywordMatches,
      expected_slug_words: slugWords,
      expected_name_words: nameWords,
    },
  };
}

function shouldBlockAdRequest(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (parsed && /\/assets\/game\/import\/ad\//i.test(parsed.pathname)) {
    return false;
  }
  return /doubleclick\.net|googlesyndication\.com|googleadservices\.com|googleads\.g\.doubleclick\.net|\/pagead\/|\/ads?[/?&]|adservice\.google\./i.test(url);
}

async function collectPageMetadata(page) {
  return await page.evaluate(() => {
    const meta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ??
      document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ??
      "";
    const perfEntries = performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize ?? 0,
      encodedBodySize: entry.encodedBodySize ?? 0,
      duration: Math.round(entry.duration),
    }));
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      title: document.title,
      meta_description: meta("description") || meta("og:description"),
      keywords: meta("keywords"),
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? "",
      manifest: document.querySelector('link[rel="manifest"]')?.href ?? "",
      url: location.href,
      navigation: nav
        ? {
            duration: Math.round(nav.duration),
            domContentLoadedEventEnd: Math.round(nav.domContentLoadedEventEnd),
            loadEventEnd: Math.round(nav.loadEventEnd),
            transferSize: nav.transferSize ?? 0,
            encodedBodySize: nav.encodedBodySize ?? 0,
          }
        : null,
      resources: perfEntries,
      bodyTextSample: document.body?.innerText?.slice(0, 2000) ?? "",
    };
  });
}

async function recoverTargetPage(page, game) {
  await page.goto(game.url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(networkIdleTimeoutMs, 8000) });
  } catch {
    // Ads and game iframes often keep the network busy; metadata can still be inspected.
  }
  await page.waitForTimeout(1800);
  const startClicked = await tryStartGame(page);
  if (startClicked) await page.waitForTimeout(1800);
  const overlayDismissed = await dismissCommonOverlays(page);
  const metadata = await collectPageMetadata(page);
  const validation = validateTargetPage(game, metadata);
  return {
    metadata,
    validation,
    start_action: startClicked ? "play_button_clicked_after_recovery" : "play_button_not_found_after_recovery",
    overlay_action: overlayDismissed ? "overlay_dismissed_after_recovery" : "no_overlay_dismissed_after_recovery",
  };
}

async function installNetworkProfile(page, profile) {
  if (!profile) return null;
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", profile);
  return session;
}

async function collectRun(game, gameDir, runConfig) {
  const startTime = Date.now();
  const screenshotDir = path.join(gameDir, "screenshots");
  const networkDir = path.join(gameDir, "network");
  const traceDir = path.join(gameDir, "traces");
  const tracePath = path.join(traceDir, `${runConfig.id}.zip`);
  const shouldTrace = traceMode !== "off";
  const consoleMessages = [];
  const pageErrors = [];
  const responses = [];
  const failedRequests = [];
  const blockedRequests = [];
  let browser = null;
  let context = null;
  let cdpSession = null;

  const result = {
    id: runConfig.id,
    label: runConfig.label,
    viewport: runConfig.viewport,
    network_profile: runConfig.networkProfileName,
    play_strategy: playStrategy,
    started_at: new Date(startTime).toISOString(),
    status: "unknown",
    timings: {},
    page: {},
    screenshots: [],
    gameplay_sample: null,
    trace: shouldTrace ? path.relative(gameDir, tracePath).replaceAll("\\", "/") : "",
    trace_mode: traceMode,
    errors: [],
  };

  try {
    browser = await chromium.launch({
      executablePath: defaultBrowserPath,
      headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });

    const device = runConfig.deviceName ? devices[runConfig.deviceName] : null;
    context = await browser.newContext({
      ...(device ?? {}),
      viewport: runConfig.viewport,
      isMobile: runConfig.isMobile ?? device?.isMobile ?? false,
      hasTouch: runConfig.hasTouch ?? device?.hasTouch ?? false,
      userAgent: device?.userAgent,
      locale: "en-US",
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (shouldBlockAdRequest(request.url())) {
        blockedRequests.push({
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
        });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    if (shouldTrace) {
      await context.tracing.start({
        screenshots: traceMode === "full",
        snapshots: traceMode === "full",
        sources: false,
      });
    }

    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(navigationTimeoutMs);

    page.on("console", (message) => {
      const type = message.type();
      if (["error", "warning"].includes(type)) {
        consoleMessages.push({ type, text: message.text(), timestamp: new Date().toISOString() });
      }
    });

    page.on("pageerror", (error) => {
      pageErrors.push({ message: error.message, timestamp: new Date().toISOString() });
    });

    page.on("response", async (response) => {
      const headers = response.headers();
      const contentLength = Number(headers["content-length"] ?? 0);
      responses.push({
        url: response.url(),
        status: response.status(),
        contentType: headers["content-type"] ?? "",
        contentLength: Number.isFinite(contentLength) ? contentLength : 0,
        requestMethod: response.request().method(),
        resourceType: response.request().resourceType(),
      });
    });

    page.on("requestfailed", (request) => {
      failedRequests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText ?? "unknown",
      });
    });

    cdpSession = await installNetworkProfile(page, runConfig.networkProfile);

    const navStart = Date.now();
    await page.goto(game.url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
    result.timings.domcontentloaded_ms = Date.now() - navStart;

    const loadStart = Date.now();
    try {
      await page.waitForLoadState("networkidle", { timeout: networkIdleTimeoutMs });
      result.timings.networkidle_ms_after_domcontentloaded = Date.now() - loadStart;
    } catch {
      result.timings.networkidle_ms_after_domcontentloaded = null;
      result.errors.push("networkidle_timeout");
    }

    await page.waitForTimeout(2500);

    const startClicked = await tryStartGame(page);
    result.start_action = startClicked ? "play_button_clicked" : "play_button_not_found";
    if (startClicked || playStrategy !== "legacy_center_tap") {
      result.gameplay_sample = await sampleGameplay(page, playSeconds, runConfig.label, {
        strategy: playStrategy,
        actionLogLimit,
      });
    }
    const overlayDismissed = await dismissCommonOverlays(page);
    result.overlay_action = overlayDismissed ? "overlay_dismissed" : "no_overlay_dismissed";

    let metadata = await collectPageMetadata(page);
    let targetValidation = validateTargetPage(game, metadata);
    if (!targetValidation.matches) {
      const beforeRecovery = {
        expected_slug: targetValidation.expected_slug,
        final_url: metadata.url,
        title: metadata.title,
        canonical: metadata.canonical,
      };
      result.target_recovery = { attempted: true, before: beforeRecovery, status: "running" };
      try {
        const recovered = await recoverTargetPage(page, game);
        metadata = recovered.metadata;
        targetValidation = recovered.validation;
        result.target_recovery = {
          ...result.target_recovery,
          status: targetValidation.matches ? "recovered" : "still_mismatched",
          after: {
            final_url: metadata.url,
            title: metadata.title,
            canonical: metadata.canonical,
          },
        };
        result.start_action = recovered.start_action;
        result.overlay_action = recovered.overlay_action;
      } catch (error) {
        result.target_recovery = {
          ...result.target_recovery,
          status: "failed",
          error: sanitizeError(error),
        };
      }
    }

    result.page = metadata;
    result.target_validation = targetValidation;
    if (!result.target_validation.matches) {
      result.errors.push({
        target_mismatch: {
          expected_slug: result.target_validation.expected_slug,
          final_url: metadata.url,
          title: metadata.title,
          canonical: metadata.canonical,
        },
      });
    }

    const screenshotPath = path.join(screenshotDir, `${runConfig.id}.png`);
    const screenshotCapture = await captureScreenshot(page, screenshotPath);
    result.screenshot_capture = {
      ...screenshotCapture,
      ...(await inspectScreenshotFile(screenshotPath)),
    };
    result.screenshots.push(path.relative(gameDir, screenshotPath).replaceAll("\\", "/"));

    const contentLengthBytes = responses.reduce((sum, item) => sum + item.contentLength, 0);
    const perfTransferBytes =
      (metadata.navigation?.transferSize ?? 0) +
      metadata.resources.reduce((sum, item) => sum + (item.transferSize ?? 0), 0);

    result.network = {
      response_count: responses.length,
      failed_request_count: failedRequests.length,
      ad_blocked_request_count: blockedRequests.length,
      content_length_mb: bytesToMb(contentLengthBytes),
      performance_transfer_mb: bytesToMb(perfTransferBytes),
      note: "content_length_mb depends on response headers; performance_transfer_mb may be 0 for cross-origin resources without Timing-Allow-Origin.",
    };
    result.status = "success";

    await fs.writeFile(
      path.join(networkDir, `${runConfig.id}.json`),
      `${JSON.stringify({ responses, failedRequests, blockedRequests, consoleMessages, pageErrors }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    result.status = "failed";
    result.errors.push(sanitizeError(error));
  } finally {
    if (cdpSession) {
      try {
        await cdpSession.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
      } catch {
        // Browser may already be closing.
      }
    }

    if (shouldTrace && context) {
      try {
        await withTimeout(context.tracing.stop({ path: tracePath }), traceStopTimeoutMs, "trace_stop_timeout");
      } catch (error) {
        result.errors.push({ trace_stop_error: sanitizeError(error) });
      }
    }
    if (context) {
      try {
        await withTimeout(context.close(), 15000, "context_close_timeout");
      } catch (error) {
        result.errors.push({ context_close_error: sanitizeError(error) });
      }
    }
    if (browser) {
      try {
        await withTimeout(browser.close(), 15000, "browser_close_timeout");
      } catch (error) {
        result.errors.push({ browser_close_error: sanitizeError(error) });
      }
    }
  }

  result.finished_at = new Date().toISOString();
  result.timings.total_ms = Date.now() - startTime;
  return result;
}

async function collectVideoClip(game, gameDir, seconds) {
  const startedAt = Date.now();
  const videoDir = path.join(gameDir, "video");
  const result = {
    id: "desktop-normal-clip",
    label: "Desktop / Local Video Clip",
    play_strategy: playStrategy,
    status: "unknown",
    duration_seconds: seconds,
    video: "",
    size_mb: 0,
    gameplay_sample: null,
    started_at: new Date(startedAt).toISOString(),
    errors: [],
  };
  let browser = null;
  let context = null;

  try {
    await cleanupRawVideoArtifacts(videoDir);
    browser = await chromium.launch({
      executablePath: defaultBrowserPath,
      headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });
    context = await browser.newContext({
      viewport: { width: 960, height: 540 },
      locale: "en-US",
      recordVideo: {
        dir: videoDir,
        size: { width: 960, height: 540 },
      },
    });
    await context.route("**/*", async (route) => {
      if (shouldBlockAdRequest(route.request().url())) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(navigationTimeoutMs);
    await page.goto(game.url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
    try {
      await page.waitForLoadState("networkidle", { timeout: networkIdleTimeoutMs });
    } catch {
      result.errors.push("networkidle_timeout");
    }
    await page.waitForTimeout(2500);
    const startClicked = await tryStartGame(page);
    result.start_action = startClicked ? "play_button_clicked" : "play_button_not_found";
    result.gameplay_sample = await sampleGameplay(page, seconds, result.label, {
      strategy: playStrategy,
      actionLogLimit,
    });
    const video = page.video();
    await page.close();
    await context.close();
    context = null;

    const generatedPath = video ? await video.path() : "";
    if (!generatedPath) throw new Error("Video path was not generated.");
    const targetPath = path.join(videoDir, `${result.id}.webm`);
    await fs.rm(targetPath, { force: true });
    await fs.rename(generatedPath, targetPath);
    const stat = await fs.stat(targetPath);
    result.video = path.relative(gameDir, targetPath).replaceAll("\\", "/");
    result.size_mb = bytesToMb(stat.size);
    result.status = "success";
    await cleanupRawVideoArtifacts(videoDir, [targetPath]);
  } catch (error) {
    result.status = "failed";
    result.errors.push(sanitizeError(error));
  } finally {
    if (context) {
      try {
        await withTimeout(context.close(), 15000, "video_context_close_timeout");
      } catch (error) {
        result.errors.push({ context_close_error: sanitizeError(error) });
      }
    }
    if (browser) {
      try {
        await withTimeout(browser.close(), 15000, "video_browser_close_timeout");
      } catch (error) {
        result.errors.push({ browser_close_error: sanitizeError(error) });
      }
    }
  }

  result.finished_at = new Date().toISOString();
  result.elapsed_ms = Date.now() - startedAt;
  return result;
}

async function cleanupRawVideoArtifacts(videoDir, keepPaths = []) {
  const keep = new Set(keepPaths.map((item) => path.resolve(item)));
  let items = [];
  try {
    items = await fs.readdir(videoDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items) {
    if (!item.isFile() || !/^page@.+\.webm$/i.test(item.name)) continue;
    const filePath = path.join(videoDir, item.name);
    if (keep.has(path.resolve(filePath))) continue;
    await fs.rm(filePath, { force: true });
  }
}

async function captureScreenshot(page, screenshotPath) {
  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      timeout: screenshotTimeoutMs,
    });
    return { method: "playwright" };
  } catch (primaryError) {
    const session = await page.context().newCDPSession(page);
    try {
      const captured = await session.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      await fs.writeFile(screenshotPath, Buffer.from(captured.data, "base64"));
      return {
        method: "cdp_fallback",
        primary_error: sanitizeError(primaryError),
      };
    } finally {
      try {
        await session.detach();
      } catch {
        // Session may already be closed with the page.
      }
    }
  }
}

async function inspectScreenshotFile(screenshotPath) {
  const bytes = await fs.readFile(screenshotPath);
  return {
    size_bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(label));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function tryStartGame(page) {
  const candidates = [
    "text=/play now/i",
    "text=/\\bplay\\b/i",
    "text=/\\bstart\\b/i",
    "text=/start game/i",
    "text=/continue/i",
    "text=/^(开始|启动|开始游戏|立即开始|继续)$/",
    "button:has-text(\"Play\")",
    "button:has-text(\"Start\")",
    "a:has-text(\"Play\")",
    "a:has-text(\"Start\")",
    "[role=button]:has-text(\"Play\")",
    "[role=button]:has-text(\"Start\")",
  ];

  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 8000 });
      await locator.click({ timeout: 3500, force: true });
      await page.waitForTimeout(5000);
      return true;
    } catch {
      // Try the next candidate.
    }
  }

  const textBox = await page.evaluate(() => {
    const visibleBox = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") return null;
      if (rect.width < 40 || rect.height < 18) return null;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return null;
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        area: rect.width * rect.height,
        textLength: (element.textContent ?? "").trim().length,
      };
    };

    const candidates = [...document.querySelectorAll("body *")]
      .filter((element) => /play now|start game|play/i.test((element.textContent ?? "").trim()))
      .map((element) => visibleBox(element))
      .filter(Boolean)
      .filter((box) => box.textLength <= 80)
      .sort((a, b) => a.area - b.area);

    return candidates[0] ?? null;
  });

  if (textBox) {
    await page.mouse.click(textBox.x, textBox.y);
    await page.waitForTimeout(5000);
    return true;
  }

  return false;
}

function compactRun(item) {
  return {
    id: item.id,
    label: item.label,
    status: item.status,
    viewport: item.viewport,
    network_profile: item.network_profile,
    play_strategy: item.play_strategy ?? "",
    start_action: item.start_action,
    overlay_action: item.overlay_action,
    gameplay_sample: item.gameplay_sample
      ? {
          strategy: item.gameplay_sample.strategy,
          status: item.gameplay_sample.status,
          duration_seconds: item.gameplay_sample.duration_seconds,
          action_count: item.gameplay_sample.action_count,
          sampled_actions: (item.gameplay_sample.actions ?? []).slice(0, 16),
          errors: item.gameplay_sample.errors ?? [],
        }
      : null,
    timings: item.timings,
    page: {
      title: item.page?.title ?? "",
      meta_description: item.page?.meta_description ?? "",
      keywords: item.page?.keywords ?? "",
      canonical: item.page?.canonical ?? "",
      final_url: item.page?.url ?? "",
      manifest: item.page?.manifest ?? "",
      navigation: item.page?.navigation ?? null,
      body_text_sample: item.page?.bodyTextSample ?? "",
      resource_count: item.page?.resources?.length ?? 0,
    },
    network: item.network ?? null,
    screenshots: item.screenshots ?? [],
    screenshot_capture: item.screenshot_capture ?? null,
    target_match: item.target_validation?.matches ?? false,
    target_validation: item.target_validation ?? null,
    target_recovery: item.target_recovery ?? null,
    trace: item.trace,
    errors: item.errors ?? [],
  };
}

async function sampleGameplay(page, seconds, label, options = {}) {
  const strategy = normalizePlayStrategy(options.strategy ?? playStrategy);
  const logLimit = Math.max(20, Number(options.actionLogLimit ?? actionLogLimit));
  const endAt = Date.now() + seconds * 1000;
  const startedAt = Date.now();
  let nextLogAt = startedAt;
  const interactionIntervalMs = ["guided_probe", "adaptive_probe"].includes(strategy)
    ? seconds >= 600 ? 12000 : 2200
    : seconds >= 600 ? 30000 : 2400;
  const sample = {
    strategy,
    status: "running",
    started_at: new Date(startedAt).toISOString(),
    finished_at: "",
    duration_seconds: seconds,
    action_count: 0,
    actions: [],
    errors: [],
  };
  console.log(`[play] ${label}: started ${seconds}s sampling (${strategy})`);
  let stepIndex = 0;
  while (Date.now() < endAt) {
    const now = Date.now();
    if (now >= nextLogAt) {
      const elapsedSeconds = Math.min(seconds, Math.round((now - startedAt) / 1000));
      console.log(`[play] ${label}: ${elapsedSeconds}/${seconds}s`);
      nextLogAt = now + 60000;
    }
    try {
      if (strategy === "passive") {
        recordGameplayAction(sample, { type: "wait", note: "passive strategy" }, logLimit);
      } else if (strategy === "adaptive_probe") {
        await performAdaptiveProbeStep(page, stepIndex, sample, logLimit);
      } else if (strategy === "guided_probe") {
        await performGuidedProbeStep(page, stepIndex, sample, logLimit);
      } else {
        await performLegacyCenterTapStep(page, sample, logLimit);
      }
    } catch (error) {
      if (page.isClosed() || /closed|crash|target/i.test(error?.message ?? "")) {
        throw error;
      }
      if (sample.errors.length < 10) sample.errors.push(sanitizeError(error));
    }
    stepIndex += 1;
    const waitMs = Math.min(interactionIntervalMs, Math.max(0, endAt - Date.now()));
    if (waitMs > 0) await page.waitForTimeout(waitMs);
  }
  sample.status = sample.errors.length ? "completed_with_warnings" : "completed";
  sample.finished_at = new Date().toISOString();
  console.log(`[play] ${label}: completed ${seconds}s sampling (${sample.action_count} actions)`);
  return sample;
}

async function performLegacyCenterTapStep(page, sample, logLimit) {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const lower = { x: Math.floor(viewport.width / 2), y: Math.floor(viewport.height * 0.72) };
  await page.mouse.click(lower.x, lower.y);
  recordGameplayAction(sample, { type: "click", target: "viewport_lower_center", ...lower }, logLimit);
  await page.waitForTimeout(700);
  const center = { x: Math.floor(viewport.width / 2), y: Math.floor(viewport.height * 0.5) };
  await page.mouse.click(center.x, center.y);
  recordGameplayAction(sample, { type: "click", target: "viewport_center", ...center }, logLimit);
}

async function performGuidedProbeStep(page, stepIndex, sample, logLimit) {
  if (stepIndex % 5 === 0) {
    const clicked = await clickLikelyActionButton(page);
    if (clicked) {
      recordGameplayAction(sample, { type: "click", target: "action_button", ...clicked }, logLimit);
      await page.waitForTimeout(600);
      return;
    }
  }

  if (stepIndex % 6 === 3) {
    const key = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"][stepIndex % 5];
    await page.keyboard.press(key);
    recordGameplayAction(sample, { type: "keypress", key }, logLimit);
    return;
  }

  const target = await detectGameplayTarget(page);
  const point = gameplayPoint(target, stepIndex);
  if (stepIndex % 4 === 1) {
    const end = dragEndPoint(target, stepIndex);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    recordGameplayAction(sample, {
      type: "drag",
      target: target.kind,
      from: point,
      to: end,
    }, logLimit);
    return;
  }

  await page.mouse.click(point.x, point.y);
  recordGameplayAction(sample, { type: "click", target: target.kind, ...point }, logLimit);
}

async function performAdaptiveProbeStep(page, stepIndex, sample, logLimit) {
  if (stepIndex % 4 === 0) {
    const clicked = await clickLikelyActionButton(page);
    if (clicked) {
      recordGameplayAction(sample, {
        type: "click",
        target: "action_button",
        mode: "adaptive_probe",
        ...clicked,
      }, logLimit);
      await page.waitForTimeout(650);
      return;
    }
  }

  if (stepIndex % 8 === 2) {
    const dismissed = await dismissCommonOverlays(page);
    recordGameplayAction(sample, {
      type: dismissed ? "overlay_dismiss" : "overlay_scan",
      target: "common_overlay",
      mode: "adaptive_probe",
      note: dismissed ? "overlay dismissed" : "no overlay affordance found",
    }, logLimit);
    return;
  }

  if (stepIndex % 6 === 3) {
    const key = ["Space", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"][stepIndex % 5];
    await page.keyboard.press(key);
    recordGameplayAction(sample, { type: "keypress", key, mode: "adaptive_probe" }, logLimit);
    return;
  }

  const target = await detectGameplayTarget(page);
  const point = gameplayPoint(target, stepIndex);
  if (stepIndex % 5 === 1) {
    const end = dragEndPoint(target, stepIndex + 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    recordGameplayAction(sample, {
      type: "drag",
      target: target.kind,
      mode: "adaptive_probe",
      from: point,
      to: end,
    }, logLimit);
    return;
  }

  await page.mouse.click(point.x, point.y);
  recordGameplayAction(sample, {
    type: "click",
    target: target.kind,
    mode: "adaptive_probe",
    ...point,
  }, logLimit);
}

async function clickLikelyActionButton(page) {
  return await page.evaluate(() => {
    const labels = /^(play|play now|start|start game|continue|next|ok|claim|tap to play|开始|开始游戏|继续|下一步|确定|领取)$/i;
    const elements = [...document.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit'], body *")];
    const visibleBox = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") return null;
      if (rect.width < 18 || rect.height < 18) return null;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return null;
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        area: rect.width * rect.height,
      };
    };
    const candidates = elements
      .map((element) => {
        const text = (element.textContent || element.getAttribute("aria-label") || element.getAttribute("value") || "").trim();
        if (!text || text.length > 40 || !labels.test(text)) return null;
        const box = visibleBox(element);
        return box ? { ...box, text } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.area - b.area);
    return candidates[0] ?? null;
  }).then(async (box) => {
    if (!box) return null;
    await page.mouse.click(box.x, box.y);
    return box;
  }).catch(() => null);
}

async function detectGameplayTarget(page) {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const fallback = {
    kind: "viewport",
    left: 0,
    top: 0,
    width: viewport.width,
    height: viewport.height,
  };
  const target = await page.evaluate(() => {
    const selectors = [
      "canvas",
      "iframe",
      "[id*='game' i]",
      "[class*='game' i]",
      "[id*='canvas' i]",
      "[class*='canvas' i]",
      "[id*='play' i]",
      "[class*='play' i]",
    ];
    const candidates = [...document.querySelectorAll(selectors.join(","))]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") return null;
        if (rect.width < 80 || rect.height < 80) return null;
        if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return null;
        const tag = element.tagName.toLowerCase();
        return {
          kind: tag === "canvas" || tag === "iframe" ? tag : "game_container",
          left: Math.max(0, Math.round(rect.left)),
          top: Math.max(0, Math.round(rect.top)),
          width: Math.round(Math.min(rect.width, innerWidth - Math.max(0, rect.left))),
          height: Math.round(Math.min(rect.height, innerHeight - Math.max(0, rect.top))),
          area: rect.width * rect.height,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.area - a.area);
    return candidates[0] ?? null;
  }).catch(() => null);
  return target ?? fallback;
}

function gameplayPoint(target, stepIndex) {
  const ratios = [
    [0.5, 0.5],
    [0.5, 0.72],
    [0.25, 0.55],
    [0.75, 0.55],
    [0.5, 0.32],
    [0.35, 0.75],
    [0.65, 0.75],
  ];
  const [rx, ry] = ratios[stepIndex % ratios.length];
  return clampTargetPoint(target, rx, ry);
}

function dragEndPoint(target, stepIndex) {
  const ratios = [
    [0.78, 0.5],
    [0.22, 0.5],
    [0.5, 0.28],
    [0.5, 0.78],
  ];
  const [rx, ry] = ratios[stepIndex % ratios.length];
  return clampTargetPoint(target, rx, ry);
}

function clampTargetPoint(target, rx, ry) {
  const minX = Math.max(8, target.left + 8);
  const maxX = Math.max(minX, target.left + target.width - 8);
  const minY = Math.max(8, target.top + 8);
  const maxY = Math.max(minY, target.top + target.height - 8);
  const x = Math.max(minX, Math.min(maxX, Math.round(target.left + target.width * rx)));
  const y = Math.max(minY, Math.min(maxY, Math.round(target.top + target.height * ry)));
  return { x, y };
}

function recordGameplayAction(sample, action, logLimit) {
  sample.action_count += 1;
  if (sample.actions.length >= logLimit) return;
  sample.actions.push({
    at_ms: Date.now() - Date.parse(sample.started_at),
    ...action,
  });
}

async function dismissCommonOverlays(page) {
  let dismissed = false;
  const selectors = [
    "text=/^close$/i",
    "text=/^x$/i",
    "text=/^skip$/i",
    "text=/^no thanks$/i",
    "text=/^(关闭|跳过|不用了|不了)$/",
    "[aria-label=\"Close\"]",
    "[aria-label=\"close\"]",
    ".close",
    ".close-button",
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 1500 });
      await locator.click({ timeout: 1500, force: true });
      await page.waitForTimeout(1500);
      dismissed = true;
      break;
    } catch {
      // Try the next close affordance.
    }
  }

  if (dismissed) {
    await dismissFullscreenAdByCoordinates(page);
    return true;
  }

  const closeBox = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("body *")]
      .map((element) => {
        const text = (element.textContent ?? "").trim();
        const aria = element.getAttribute("aria-label") ?? "";
        const label = `${text} ${aria}`.trim();
        if (!/^(close|x|skip|关闭|跳过)$/i.test(label)) return null;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") return null;
        if (rect.width < 8 || rect.height < 8) return null;
        if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, area: rect.width * rect.height };
      })
      .filter(Boolean)
      .sort((a, b) => a.area - b.area);

    return candidates[0] ?? null;
  });

  if (closeBox) {
    await page.mouse.click(closeBox.x, closeBox.y);
    await page.waitForTimeout(1500);
    await dismissFullscreenAdByCoordinates(page);
    return true;
  }

  return await dismissFullscreenAdByCoordinates(page);
}

async function dismissFullscreenAdByCoordinates(page) {
  const likelyAdOverlay = await page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    return (
      location.href.includes("goog_fullscreen_ad") ||
      /advertisement|sponsored|adchoices/i.test(text) ||
      (/^close$/im.test(text) && /\bopen\b/i.test(text))
    );
  }).catch(() => false);

  if (!likelyAdOverlay) return false;

  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } catch {
    // Continue with coordinate close attempts.
  }

  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const candidates = [
    { x: viewport.width - 144, y: 106 },
    { x: viewport.width - 96, y: 106 },
    { x: viewport.width - 44, y: 44 },
    { x: viewport.width * 0.9, y: viewport.height * 0.12 },
    { x: viewport.width * 0.94, y: viewport.height * 0.08 },
  ];

  for (const point of candidates) {
    try {
      await page.mouse.click(Math.max(8, Math.min(viewport.width - 8, point.x)), Math.max(8, Math.min(viewport.height - 8, point.y)));
      await page.waitForTimeout(1200);
      const stillLikelyAd = await page.evaluate(() => {
        const text = document.body?.innerText ?? "";
        return location.href.includes("goog_fullscreen_ad") && /^close$/im.test(text) && /\bopen\b/i.test(text);
      }).catch(() => false);
      if (!stillLikelyAd) return true;
    } catch {
      // Try the next point.
    }
  }

  return false;
}

function buildReports(game, results, videos = []) {
  const successful = results.filter((item) => item.status === "success");
  const successfulWithScreenshots = results.filter((item) => item.status === "success" && (item.screenshots ?? []).length > 0);
  const targetMatchedWithScreenshots = successfulWithScreenshots.filter((item) => item.target_validation?.matches);
  const evidenceRuns = targetMatchedWithScreenshots;
  const qualityWarnings = buildEvidenceQualityWarnings(evidenceRuns, videos);
  const first = evidenceRuns[0] ?? successfulWithScreenshots[0] ?? successful[0] ?? results[0];
  const normalRun = evidenceRuns.find((item) => item.id === "desktop-normal") ?? evidenceRuns.find((item) => item.network_profile === "normal") ?? null;
  const slowRun = evidenceRuns.find((item) => item.network_profile === "slow4g") ?? null;
  const targetMismatchedRuns = successfulWithScreenshots
    .filter((item) => !item.target_validation?.matches)
    .map((item) => item.id);
  const excludedScreenshots = successfulWithScreenshots
    .filter((item) => !item.target_validation?.matches)
    .flatMap((item) => (item.screenshots ?? []).map((screenshot) => ({ run_id: item.id, screenshot })));
  const collectionStatus =
    targetMatchedWithScreenshots.length === 0
      ? "failed"
      : targetMatchedWithScreenshots.length < results.length
        ? "partial_collected"
        : "collected";
  const collectionQuality = {
    expected_runs: results.length,
    successful_runs: successful.length,
    successful_runs_with_screenshots: successfulWithScreenshots.length,
    target_matched_runs_with_screenshots: targetMatchedWithScreenshots.length,
    target_mismatched_runs: targetMismatchedRuns,
    screenshot_count: evidenceRuns.flatMap((item) => item.screenshots ?? []).length,
    all_screenshot_count: successfulWithScreenshots.flatMap((item) => item.screenshots ?? []).length,
    excluded_screenshot_count: excludedScreenshots.length,
    excluded_screenshots: excludedScreenshots,
    video_count: videos.filter((item) => item.status === "success" && item.video).length,
    failed_runs: results.filter((item) => item.status !== "success").map((item) => item.id),
    play_strategy: playStrategy,
    autoplay_action_count: results.reduce((sum, item) => sum + Number(item.gameplay_sample?.action_count ?? 0), 0),
    quality_status: qualityWarnings.length ? "needs_review" : "clear",
    quality_warnings: qualityWarnings,
  };
  const zh = {
    game_id: game.game_id,
    game_name: game.game_name,
    url: game.url,
    status: collectionStatus,
    collection_quality: collectionQuality,
    backend_language: "zh",
    export_language: "en",
    page_title: first?.page?.title ?? "",
    meta_description: first?.page?.meta_description ?? "",
    keywords: first?.page?.keywords ?? "",
    normal_network_load_ms: normalRun?.timings ?? null,
    slow_4g_load_ms: slowRun?.timings ?? null,
    package_size_estimate_mb: first?.network ?? null,
    screenshots: evidenceRuns.flatMap((item) => item.screenshots ?? []),
    traces: evidenceRuns.map((item) => item.trace).filter(Boolean),
    videos: videos.map((item) => item.video).filter(Boolean),
    video_clips: videos,
    autoplay: buildAutoplayManifest(results, videos),
    runs: results.map(compactRun),
    note: "POC browser evidence collected. AI fields are generated by the AI evaluation step.",
  };

  const en = {
    game_id: game.game_id,
    game_name: game.game_name,
    url: game.url,
    status: collectionStatus,
    collection_quality: collectionQuality,
    page_title: zh.page_title,
    meta_description: zh.meta_description,
    tags_keywords: zh.keywords,
    normal_network_load_ms: zh.normal_network_load_ms,
    slow_4g_load_ms: zh.slow_4g_load_ms,
    package_size_estimate_mb: zh.package_size_estimate_mb,
    evidence: {
      screenshots: zh.screenshots,
      traces: zh.traces,
      videos: zh.videos,
    },
    autoplay: zh.autoplay,
    note: "Browser evidence has been collected. AI-generated gameplay, theme, art style, controls, FAQ, and product copy will be added after the vision model integration.",
    runs: results.map(compactRun),
  };

  return { zh, en };
}

function buildEvidenceQualityWarnings(evidenceRuns, videos = []) {
  const warnings = [];
  const screenshotEntries = evidenceRuns.flatMap((run) =>
    (run.screenshots ?? []).map((screenshot) => ({
      run_id: run.id,
      label: run.label,
      screenshot,
      sha256: run.screenshot_capture?.sha256 ?? "",
    })),
  );
  const hashGroups = new Map();
  for (const entry of screenshotEntries) {
    if (!entry.sha256) continue;
    if (!hashGroups.has(entry.sha256)) hashGroups.set(entry.sha256, []);
    hashGroups.get(entry.sha256).push(entry);
  }
  const duplicateGroups = [...hashGroups.values()].filter((group) => group.length > 1);
  if (duplicateGroups.length) {
    warnings.push({
      level: "warn",
      code: "duplicate_screenshot_hash",
      title: "截图疑似重复",
      detail: duplicateGroups
        .map((group) => group.map((item) => item.run_id).join(" / "))
        .join("; "),
    });
  }

  const overlayRuns = evidenceRuns.filter((run) => hasEvidenceBlockingOverlay(run));
  if (overlayRuns.length) {
    warnings.push({
      level: "warn",
      code: "ad_or_orientation_overlay",
      title: "广告或方向提示疑似遮挡",
      detail: overlayRuns.map((run) => run.id).join(" / "),
    });
  }

  const activeRuns = evidenceRuns.filter((run) => Number(run.gameplay_sample?.action_count ?? 0) >= 20);
  const lowTextRuns = activeRuns.filter((run) => getEvidenceBodyText(run).trim().length <= 20);
  if (duplicateGroups.length && activeRuns.length >= 2 && lowTextRuns.length >= Math.ceil(activeRuns.length * 0.5)) {
    warnings.push({
      level: "warn",
      code: "gameplay_visual_unconfirmed",
      title: "玩法画面未确认",
      detail: "自动试玩已有动作记录，但页面可读文本很少且存在重复截图，建议人工确认是否停留在加载页或静态首屏。",
    });
  }

  const failedVideos = videos.filter((item) => item.status !== "success");
  if (failedVideos.length) {
    warnings.push({
      level: "warn",
      code: "video_recording_failed",
      title: "本地视频未完整生成",
      detail: failedVideos.map((item) => item.id).join(" / "),
    });
  }

  return warnings;
}

function getEvidenceBodyText(run) {
  return String(run.page?.bodyTextSample ?? run.page?.body_text_sample ?? "");
}

function hasEvidenceBlockingOverlay(run) {
  const bodyText = getEvidenceBodyText(run);
  const textSuggestsOverlay = /advertisement|adchoices|sponsored|please rotate|rotate screen|turn your device|orientation/i.test(bodyText);
  const repeatedPlayClicks = (run.gameplay_sample?.sampled_actions ?? run.gameplay_sample?.actions ?? [])
    .filter((action) => action?.target === "action_button" && /play|start/i.test(String(action.text ?? "")))
    .length;
  return textSuggestsOverlay && (repeatedPlayClicks > 0 || run.overlay_action === "overlay_dismissed");
}

function buildAutoplayManifest(results, videos = []) {
  const runs = [...results, ...videos].map((item) => ({
    id: item.id,
    label: item.label,
    strategy: item.play_strategy ?? playStrategy,
    status: item.gameplay_sample?.status ?? "not_run",
    action_count: item.gameplay_sample?.action_count ?? 0,
    sampled_actions: (item.gameplay_sample?.actions ?? []).slice(0, 24),
    errors: item.gameplay_sample?.errors ?? [],
  }));
  return {
    status: runs.some((item) => item.action_count > 0) ? "recorded" : "empty",
    strategy: playStrategy,
    note: "Browser interaction strategy with action logs. adaptive_probe is vision-ready scaffolding, not a paid multimodal decision loop yet.",
    runs,
  };
}

const games = await readCsv(sampleFile);
const game = games.find((item) => item.game_id === targetGameId);
if (!game) {
  throw new Error(`Game not found in samples/games.csv: ${targetGameId}`);
}

if (!(await fileExists(defaultBrowserPath))) {
  throw new Error(`Edge executable not found: ${defaultBrowserPath}`);
}

const gameDir = path.join(evidenceRoot, game.game_id);
await resetCollectionArtifacts(gameDir);

const runConfigs = [
  {
    id: "desktop-normal",
    label: "Desktop / Normal Network",
    viewport: { width: 1440, height: 900 },
    networkProfileName: "normal",
    networkProfile: null,
  },
  {
    id: "mobile-portrait-normal",
    label: "Mobile Portrait / Normal Network",
    deviceName: "iPhone 13",
    viewport: { width: 390, height: 844 },
    networkProfileName: "normal",
    networkProfile: null,
  },
  {
    id: "mobile-landscape-normal",
    label: "Mobile Landscape / Normal Network",
    deviceName: "iPhone 13 landscape",
    viewport: { width: 844, height: 390 },
    networkProfileName: "normal",
    networkProfile: null,
  },
  {
    id: "mobile-portrait-slow4g",
    label: "Mobile Portrait / Slow 4G",
    deviceName: "iPhone 13",
    viewport: { width: 390, height: 844 },
    networkProfileName: "slow4g",
    networkProfile: slow4g,
  },
];

const results = [];
for (const runConfig of runConfigs) {
  console.log(`Collecting ${runConfig.label}...`);
  results.push(await collectRun(game, gameDir, runConfig));
}

const videoClips = [];
if (recordVideo && videoSeconds > 0) {
  console.log(`Collecting local video clip (${videoSeconds}s)...`);
  videoClips.push(await collectVideoClip(game, gameDir, videoSeconds));
}

const { zh, en } = buildReports(game, results, videoClips);
await fs.writeFile(path.join(gameDir, "report.zh.json"), `${JSON.stringify(zh, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(gameDir, "report.en.json"), `${JSON.stringify(en, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(gameDir, "autoplay_manifest.json"), `${JSON.stringify(zh.autoplay, null, 2)}\n`, "utf8");

const videoManifest = {
  status: recordVideo ? (videoClips.some((item) => item.status === "success") ? "recorded" : "failed") : "disabled",
  storage: "local_only",
  upload_policy: "Videos are kept in the local evidence folder and are not uploaded to Feishu.",
  configured_duration_seconds: videoSeconds,
  videos: videoClips,
};
await fs.writeFile(path.join(gameDir, "video", "manifest.json"), `${JSON.stringify(videoManifest, null, 2)}\n`, "utf8");

console.log(`POC evidence collected in ${gameDir}`);
if (failOnPartial && zh.status !== "collected") {
  console.error(`Collection did not complete all required runs: ${zh.status}`);
  process.exitCode = 1;
}
