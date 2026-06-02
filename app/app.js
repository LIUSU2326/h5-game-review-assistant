const APP_VERSION_LABEL = "v1.8.3 rc.8";

const state = {
  status: null,
  configWorkbench: null,
  fieldComposer: null,
  fieldComposerDiff: null,
  fieldComposerApply: null,
  taxonomySuggestions: null,
  taxonomyWritebackPreview: null,
  taxonomyWritebackResult: null,
  selectedGameId: "",
  currentView: "workbench",
  currentWorkbenchMode: "workbench",
  jobs: [],
  activeJobId: "",
  consoleText: "",
  resultFilter: "all",
  configTaxonomyFilter: {
    category: "all",
    status: "all",
    query: "",
  },
  batchHistoryFilters: {
    status: "all",
    mode: "all",
    query: "",
  },
  selectedBatchHistoryIndex: null,
  consoleExpanded: false,
  nextStepAction: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  navGameCount: $("#navGameCount"),
  navConfigState: $("#navConfigState"),
  navJobState: $("#navJobState"),
  navWriteState: $("#navWriteState"),
  metricShots: $("#metricShots"),
  metricVideos: $("#metricVideos"),
  metricFlags: $("#metricFlags"),
  runSelectedButton: $("#runSelectedButton"),
  batchDryRunButton: $("#batchDryRunButton"),
  batchDryRunPanelButton: $("#batchDryRunPanelButton"),
  batchRunButton: $("#batchRunButton"),
  nextStepCard: $("#nextStepCard"),
  nextStepTitle: $("#nextStepTitle"),
  nextStepDetail: $("#nextStepDetail"),
  nextStepAction: $("#nextStepAction"),
  queuePanelTitle: $("#queuePanelTitle"),
  queuePanelHint: $("#queuePanelHint"),
  pipelineState: $("#pipelineState"),
  pipelineNote: $("#pipelineNote"),
  geminiState: $("#geminiState"),
  geminiModel: $("#geminiModel"),
  feishuState: $("#feishuState"),
  feishuTable: $("#feishuTable"),
  sampleCount: $("#sampleCount"),
  writtenCount: $("#writtenCount"),
  aiForm: $("#aiForm"),
  feishuForm: $("#feishuForm"),
  gameSelect: $("#gameSelect"),
  resultOverview: $("#resultOverview"),
  gameTableBody: $("#gameTableBody"),
  tableStatus: $("#tableStatus"),
  batchHistoryPanel: $("#batchHistoryPanel"),
  detailPanel: $("#detailPanel"),
  jobSummary: $("#jobSummary"),
  jobOutput: $("#jobOutput"),
  cancelJobButton: $("#cancelJobButton"),
  batchGameIds: $("#batchGameIds"),
  removeBatchSelectedButton: $("#removeBatchSelectedButton"),
  clearBatchQueueButton: $("#clearBatchQueueButton"),
  batchSummary: $("#batchSummary"),
  autoplayPreflight: $("#autoplayPreflight"),
  setupSteps: $("#setupSteps"),
  setupProgressText: $("#setupProgressText"),
  setupMeter: $("#setupMeter"),
  storageRootText: $("#storageRootText"),
  storageEvidenceText: $("#storageEvidenceText"),
  storageScreenshotText: $("#storageScreenshotText"),
  configWorkbench: $("#configWorkbench"),
  fieldComposer: $("#fieldComposer"),
};

init();

async function init() {
  bindEvents();
  await refreshStatus();
  setInterval(refreshJobs, 1600);
}

function bindEvents() {
  $("#refreshButton").addEventListener("click", refreshStatus);
  $("#quickCheckButton").addEventListener("click", () => startJob("quick-check"));
  $("#openDataFolderButton").addEventListener("click", openDataFolder);
  $("#saveConfigButton").addEventListener("click", saveConfig);
  $("#importUrlsButton").addEventListener("click", importUrls);
  elements.runSelectedButton.addEventListener("click", runSelectedGame);
  elements.nextStepAction?.addEventListener("click", performNextStepAction);
  $("#fillBatchAllButton").addEventListener("click", fillBatchAll);
  $("#fillBatchSelectedButton").addEventListener("click", fillBatchSelected);
  $("#removeBatchSelectedButton").addEventListener("click", removeBatchSelected);
  $("#clearBatchQueueButton").addEventListener("click", clearBatchQueue);
  $("#fillBatchFailedButton").addEventListener("click", () => fillBatchFailed());
  $("#fillBatchResumeButton").addEventListener("click", () => fillBatchResume());
  elements.batchDryRunButton.addEventListener("click", () => runBatch(false));
  elements.batchDryRunPanelButton.addEventListener("click", () => runBatch(false));
  elements.batchRunButton.addEventListener("click", () => runBatch(true));
  elements.batchGameIds.addEventListener("input", () => {
    renderBatchSummary();
    renderAutoplayPreflight();
    renderRunGate();
    renderNextStep();
    if (["workbench", "queue"].includes(contextMode())) renderContextPanel();
  });
  $("#toggleConsoleButton").addEventListener("click", toggleConsole);
  elements.cancelJobButton.addEventListener("click", cancelActiveJob);
  $("#shotLightboxClose")?.addEventListener("click", closeShotPreview);
  $("#shotLightboxBackdrop")?.addEventListener("click", closeShotPreview);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeShotPreview();
  });

  $$(".rail-item[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      activateSection(button.dataset.jump, button.dataset.view, button.dataset.workbenchMode);
    });
  });

  $$("[data-guide-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activateSection(button.dataset.guideJump, button.dataset.guideView);
    });
  });

  $$("[data-job]").forEach((button) => {
    button.addEventListener("click", () => startJob(button.dataset.job));
  });

  elements.aiForm?.activeProvider?.addEventListener("change", () => {
    setActiveAiProviderDraft(elements.aiForm.activeProvider.value);
  });

  $$("[data-ai-provider-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("input, select, button, label")) return;
      setActiveAiProviderDraft(card.dataset.aiProviderCard);
    });
  });

  elements.gameSelect.addEventListener("change", () => {
    state.selectedGameId = elements.gameSelect.value;
    renderGames();
    renderAutoplayPreflight();
    updateQueueControls();
    renderRunGate();
    renderNextStep();
    renderContextPanel();
  });
  $("#runProfile").addEventListener("change", () => {
    applyRunProfile($("#runProfile").value);
    renderBatchSummary();
    renderAutoplayPreflight();
    renderRunGate();
    renderNextStep();
    renderContextPanel();
  });
  $("#playStrategy").addEventListener("change", () => {
    renderRunProfileNote();
    renderBatchSummary();
    renderAutoplayPreflight();
    renderRunGate();
    renderNextStep();
    renderContextPanel();
  });
  ["#playSeconds", "#aiMode", "#writeFeishu", "#forceCollect", "#forceAi", "#batchContinueOnError"].forEach((selector) => {
    $(selector)?.addEventListener("change", () => {
      if (state.status) renderStatus();
      renderRunProfileNote();
      renderBatchSummary();
      renderAutoplayPreflight();
      renderRunGate();
      renderNextStep();
      renderContextPanel();
    });
  });
}

function activateSection(targetId, preferredView, workbenchMode) {
  const target = document.getElementById(targetId);
  const viewName = preferredView || target?.closest(".workspace-view")?.dataset.view || targetId;
  const workbench = $("#workbench");
  const nextMode = viewName === "workbench" ? (workbenchMode || "workbench") : "";
  const shouldScrollToTarget = Boolean(target && target.id !== viewName && target.closest(".workspace-view"));
  state.currentView = viewName || "workbench";
  state.currentWorkbenchMode = nextMode;

  if (viewName) {
    $$(".workspace-view").forEach((view) => {
      view.classList.toggle("active", view.dataset.view === viewName || view.id === viewName);
    });
  }
  if (workbench && (viewName === "workbench" || workbenchMode)) {
    workbench.dataset.mode = nextMode || "workbench";
  }
  setNavigationActive();
  const scrollHost = $("#mainWorkspace") ?? document.documentElement;
  if (scrollHost) {
    requestAnimationFrame(() => {
      if (shouldScrollToTarget) {
        target.scrollIntoView({ block: "start", behavior: "auto" });
      } else {
        scrollHost.scrollTo({ top: 0, behavior: "auto" });
      }
    });
  }
  renderWorkbenchMode();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
}

function setNavigationActive() {
  const isActive = (item) => {
    const view = item.dataset.view;
    const mode = item.dataset.workbenchMode || "";
    if (state.currentView === "workbench") {
      return view === "workbench" && mode === state.currentWorkbenchMode;
    }
    return view === state.currentView && !mode;
  };
  $$(".rail-item").forEach((item) => item.classList.toggle("active", isActive(item)));
}

function setActiveAiProviderDraft(provider) {
  if (!provider || !elements.aiForm?.activeProvider) return;
  const config = state.status?.config ?? {};
  const ai = aiConfig(config);
  if (state.status?.config) {
    state.status.config.ai = {
      ...ai,
      active_provider: provider,
      providers: ai.providers ?? {},
    };
  }
  elements.aiForm.activeProvider.value = provider;
  updateAiProviderStates(aiConfig(state.status?.config));
  renderStatus();
  renderSetupGuide();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
}

function aiConfig(config = state.status?.config ?? {}) {
  const gemini = config.gemini ?? {};
  return config.ai ?? {
    active_provider: "gemini",
    providers: {
      gemini: {
        ...gemini,
        runtime_ready: true,
      },
    },
  };
}

function activeAiProvider(ai) {
  return ai?.providers?.[ai.active_provider || "gemini"] ?? ai?.providers?.gemini ?? {};
}

function aiRuntimeReady(provider) {
  return Boolean(provider?.api_key_configured && provider?.runtime_ready);
}

function aiProviderLabel(provider) {
  return {
    gemini: "Gemini",
    openai_compatible: "OpenAI 兼容",
    deepseek: "DeepSeek",
    openrouter: "OpenRouter",
  }[provider] || provider || "AI";
}

function updateAiProviderStates(ai) {
  const providers = ai.providers ?? {};
  const activeProvider = ai.active_provider || "gemini";
  for (const [provider, id] of Object.entries({
    gemini: "geminiProviderState",
    openai_compatible: "openaiProviderState",
    deepseek: "deepseekProviderState",
    openrouter: "openrouterProviderState",
  })) {
    const node = document.getElementById(id);
    if (!node) continue;
    const info = providers[provider] ?? {};
    node.textContent = info.api_key_configured
      ? (info.runtime_ready ? "已接入" : "已保存")
      : (info.runtime_ready ? "可配置" : "预留");
  }
  $$("[data-ai-provider-card]").forEach((card) => {
    const isActive = card.dataset.aiProviderCard === activeProvider;
    card.classList.toggle("active", isActive);
    card.classList.toggle("collapsed", !isActive);
    card.setAttribute("aria-expanded", String(isActive));
  });
}

async function refreshStatus() {
  const [response, fieldComposer, taxonomySuggestions] = await Promise.all([
    fetchJson("/api/status"),
    fetchJson("/api/field-composer").catch(() => null),
    fetchJson("/api/taxonomy-suggestions").catch(() => null),
  ]);
  state.status = response;
  state.configWorkbench = null;
  state.fieldComposer = fieldComposer?.composer ?? null;
  state.fieldComposerDiff = fieldComposer?.last_diff ?? null;
  state.fieldComposerApply = fieldComposer?.last_apply ?? null;
  state.taxonomySuggestions = taxonomySuggestions;
  state.taxonomyWritebackPreview = taxonomySuggestions?.writeback_preview ?? null;
  state.taxonomyWritebackResult = taxonomySuggestions?.writeback_result ?? null;
  if (!state.selectedGameId) {
    state.selectedGameId = response.games?.[0]?.game_id ?? "";
  }
  setNavigationActive();
  renderStatus();
  renderConfigForms();
  renderFieldComposerWorkbench();
  renderSetupGuide();
  renderRunProfiles();
  renderGames();
  renderBatchSummary();
  renderAutoplayPreflight();
  renderBatchHistoryPanel();
  renderWorkbenchMode();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
}

async function refreshJobs() {
  const response = await fetchJson("/api/jobs");
  state.jobs = response.jobs ?? [];
  const active = state.jobs.find((job) => job.id === state.activeJobId) ?? state.jobs[0];
  if (active) state.activeJobId = active.id;
  renderJobs();
  if (state.jobs.some((job) => ["running", "cancelling"].includes(job.status))) return;
  if (state.jobs.some((job) => job.needsRefresh)) {
    state.jobs.forEach((job) => {
      job.needsRefresh = false;
    });
    await refreshStatus();
  }
  if (contextMode() === "queue") renderContextPanel();
}

function renderStatus() {
  const games = state.status.games ?? [];
  const configured = state.status.config ?? {};
  const ai = aiConfig(configured);
  const activeAi = activeAiProvider(ai);
  const written = games.filter((game) => ["updated", "written"].includes(game.feishu_write_status)).length;
  const running = state.jobs.filter((job) => job.status === "running").length;
  const ready = aiRuntimeReady(activeAi) && configured.feishu?.app_id_configured && configured.feishu?.app_secret_configured;
  const screenshotCount = games.reduce((sum, game) => sum + (game.screenshots?.length ?? 0), 0);
  const videoCount = games.reduce((sum, game) => sum + (game.videos?.length ?? 0), 0);
  const flagCount = games.reduce((sum, game) => sum + qualitySignals(game).length, 0);
  const writeText = $("#writeFeishu")?.checked === false ? "不写飞书" : "写入飞书";

  elements.navGameCount.textContent = "03";
  elements.navConfigState.textContent = "05";
  elements.navJobState.textContent = "02";
  if (elements.navWriteState) elements.navWriteState.textContent = String(written);
  elements.pipelineState.textContent = ready
    ? `正式 30 分钟 / 4 档设备 / ${aiProviderLabel(ai.active_provider)} / ${writeText}`
    : "待配置";
  elements.pipelineNote.textContent = state.status.data_root ?? "E:\\H5游戏评测助手数据";
  elements.geminiState.textContent = aiProviderLabel(ai.active_provider);
  elements.geminiModel.textContent = activeAi?.api_key_configured
    ? (activeAi.runtime_ready ? activeAi.model || "标签匹配" : "已保存，待接入")
    : "未配置";
  elements.feishuState.textContent = configured.feishu?.ready ? "已连接配置" : "待检查";
  elements.feishuTable.textContent = configured.feishu?.evaluation_table_id ? `表 ${configured.feishu.evaluation_table_id}` : "-";
  elements.sampleCount.textContent = `${games.length} 款`;
  elements.metricShots.textContent = String(screenshotCount);
  elements.metricVideos.textContent = String(videoCount);
  elements.metricFlags.textContent = String(flagCount);
  elements.writtenCount.textContent = configured.feishu?.ready
    ? `字段就绪 · ${configured.feishu?.upload_screenshots ? "截图附件字段" : "截图本地路径"}`
    : "字段待检查";
}

function renderWorkbenchMode() {
  const modes = {
    workbench: ["评测队列", "导入后先预演，再运行。"],
    queue: ["任务队列", "批量预演、运行、失败恢复和清空当前队列输入。"],
    library: ["游戏库", "查看每款游戏的采集、AI、飞书写入和质量状态。"],
    review: ["证据复核", "集中检查截图、质量提示和人工复核结果。"],
  };
  const [title, hint] = modes[contextMode()] ?? modes.workbench;
  if (elements.queuePanelTitle) elements.queuePanelTitle.textContent = title;
  if (elements.queuePanelHint) elements.queuePanelHint.textContent = hint;
}

function fieldComposerWriteReadiness() {
  const status = state.fieldComposerDiff?.status || "";
  if (!state.fieldComposer) {
    return { ok: false, label: "读取字段中", detail: "字段编排器还在读取，请稍后再运行。", action: null };
  }
  if (!status) {
    return { ok: false, label: "先检查字段", detail: "先检查分类表和字段差异；只检查，不会改动飞书。", action: { label: "检查字段", scroll: "fieldComposer", fieldDiff: true } };
  }
  if (status === "ready") {
    return { ok: true, label: "字段已就绪", detail: "飞书分类表和字段结构已匹配。" };
  }
  if (status === "needs_confirmation") {
    const summary = state.fieldComposerDiff?.summary ?? {};
    const missingTables = Number(summary.missing_tables ?? 0);
    const missingFields = Number(summary.missing_fields ?? 0);
    return {
      ok: false,
      label: "确认创建分类表",
      detail: `飞书缺少 ${missingTables} 个分类表、${missingFields} 个字段；确认后工具只新增，不删除、不改类型。`,
      action: { label: "去确认", scroll: "fieldComposer" },
    };
  }
  if (status === "blocked_type_conflict") {
    const count = Number(state.fieldComposerDiff?.summary?.type_conflicts ?? 0);
    return { ok: false, label: "处理字段冲突", detail: `${count} 个飞书已有字段类型与本地编排冲突，需要先人工调整。`, action: { label: "查看冲突", scroll: "fieldComposer" } };
  }
  if (status === "needs_feishu_config") {
    return { ok: false, label: "先配置飞书", detail: "飞书凭证或多维表格目标还没有就绪。", action: { label: "去配置", scroll: "config" } };
  }
  return { ok: false, label: "重新检查字段", detail: "最近一次字段检查未通过，先重新检查飞书差异。", action: { label: "重新检查", scroll: "fieldComposer", fieldDiff: true } };
}

function buildRunGate(options = {}) {
  const batch = Boolean(options.batch);
  if (!state.status) {
    return { canRun: false, label: "读取中", detail: "正在读取配置和游戏列表。" };
  }
  const games = state.status.games ?? [];
  if (!games.length) {
    return { canRun: false, label: "先导入游戏", detail: "先导入至少一个 H5 游戏链接。" };
  }
  if (!batch && !selectedGame()) {
    return { canRun: false, label: "先选择游戏", detail: "选择一款游戏后再运行。" };
  }

  const config = state.status.config ?? {};
  const ai = aiConfig(config);
  const activeAi = activeAiProvider(ai);
  const aiMode = $("#aiMode")?.value || profileAiMode(currentRunProfile());
  if (aiMode === "live" && !aiRuntimeReady(activeAi)) {
    return {
      canRun: false,
      label: "先配置 AI",
      detail: `${aiProviderLabel(ai.active_provider)} 还不能用于生产评测。先填写 API Key，或把 AI 模式改成本地兜底。`,
    };
  }

  const wantsFeishu = $("#writeFeishu")?.checked !== false;
  if (wantsFeishu) {
    if (!config.feishu?.ready) {
      return { canRun: false, label: "先检查飞书", detail: "飞书凭证和目标多维表格还没有通过检查。" };
    }
    const fieldState = fieldComposerWriteReadiness();
    if (!fieldState.ok) {
      return { canRun: false, label: fieldState.label, detail: fieldState.detail };
    }
  }

  return {
    canRun: true,
    label: batch ? "运行" : "开始运行",
    detail: batch ? "按当前队列或全部样本开始批量运行。" : "运行当前选中的游戏。",
  };
}

function buildDryRunGate() {
  if (!state.status) return { canRun: false, label: "读取中", detail: "正在读取配置和游戏列表。" };
  const games = state.status.games ?? [];
  if (!games.length) {
    return { canRun: false, label: "先导入游戏", detail: "先导入至少一个 H5 游戏链接，再预演队列。" };
  }
  return { canRun: true, label: "预演队列", detail: "只生成队列计划，不采集、不写入飞书。" };
}

function applyButtonGate(button, gate, fallbackLabel) {
  if (!button) return;
  button.disabled = !gate.canRun;
  button.textContent = gate.canRun ? (fallbackLabel || gate.label) : gate.label;
  button.title = gate.detail || "";
}

function renderRunGate() {
  const singleGate = buildRunGate({ batch: false });
  const batchGate = buildRunGate({ batch: true });
  const dryRunGate = buildDryRunGate();
  applyButtonGate(elements.runSelectedButton, singleGate, "开始运行");
  applyButtonGate($("#panelRunSelectedButton"), singleGate, "开始运行");
  applyButtonGate(elements.batchRunButton, batchGate, "运行");
  applyButtonGate(elements.batchDryRunButton, dryRunGate, "预演队列");
  applyButtonGate(elements.batchDryRunPanelButton, dryRunGate, "预演");
}

function currentNextStep() {
  if (!state.status) {
    return { tone: "warn", title: "读取状态", detail: "正在确认配置、字段和队列。" };
  }
  const steps = setupStepsData();
  const incomplete = steps.find((step) => !step.done);
  if (incomplete) {
    return { tone: "warn", title: incomplete.title, detail: incomplete.detail, action: incomplete.action };
  }

  const taxonomyCount = Number(state.status.config?.taxonomy?.option_count ?? 0);
  if (!taxonomyCount) {
    const hasTaxonomyTable = Boolean(state.status.config?.feishu?.taxonomy_table_id);
    return {
      tone: "warn",
      title: "同步飞书标签库",
      detail: "玩法、题材、画风等选项需要先从飞书表格读取。",
      action: hasTaxonomyTable
        ? { label: "同步标签库", job: "taxonomy-sync" }
        : { label: "去配置", scroll: "config" },
    };
  }

  const wantsFeishu = $("#writeFeishu")?.checked !== false;
  if (wantsFeishu) {
    const fieldState = fieldComposerWriteReadiness();
    if (!fieldState.ok) {
      return {
        tone: "warn",
        title: fieldState.label,
        detail: fieldState.detail,
        action: fieldState.action || { label: "去配置", scroll: "config" },
      };
    }
  }

  const games = state.status.games ?? [];
  if (!games.length) {
    return {
      tone: "warn",
      title: "导入 H5 链接",
      detail: "支持不同在线试玩站点的链接，不要求固定 URL 格式。",
      action: { label: "导入链接", focus: "urlInput" },
    };
  }

  if (contextMode() === "queue") {
    return {
      tone: "good",
      title: "预演或运行队列",
      detail: "先用预演确认范围，再开始批量运行。",
      action: { label: "预演队列", dryRun: true },
    };
  }
  const game = selectedGame();
  return {
    tone: "good",
    title: "可以开始运行",
    detail: game ? `当前选中：${game.game_name || game.game_id}` : "选择游戏后即可运行。",
    action: { label: "开始运行", run: true },
  };
}

function renderNextStep() {
  if (!elements.nextStepCard) return;
  const step = currentNextStep();
  state.nextStepAction = step.action ?? null;
  elements.nextStepCard.classList.toggle("good", step.tone === "good");
  elements.nextStepCard.classList.toggle("warn", step.tone !== "good");
  elements.nextStepTitle.textContent = step.title;
  elements.nextStepDetail.textContent = step.detail;
  if (elements.nextStepAction) {
    elements.nextStepAction.hidden = !step.action;
    elements.nextStepAction.disabled = !step.action;
    elements.nextStepAction.textContent = step.action?.label || "查看";
    elements.nextStepAction.title = step.detail || "";
  }
}

async function performNextStepAction() {
  const action = state.nextStepAction;
  if (!action) return;
  if (action.scroll) activateSection(action.scroll, action.view, action.mode);
  if (action.focus) {
    activateSection("overview", "workbench", "workbench");
    requestAnimationFrame(() => document.getElementById(action.focus)?.focus());
  }
  if (action.job) await startJob(action.job);
  if (action.fieldDiff) await checkFieldComposerDiff();
  if (action.dryRun) await runBatch(false);
  if (action.run) await runSelectedGame();
}

function renderConfigForms() {
  const config = state.status.config ?? {};
  const ai = aiConfig(config);
  const providers = ai.providers ?? {};
  const form = elements.aiForm;
  if (form) {
    form.activeProvider.value = ai.active_provider || "gemini";
    form.geminiModel.value = providers.gemini?.model ?? "gemini-2.5-flash-lite";
    form.geminiProxy.value = providers.gemini?.proxy ?? "";
    form.geminiApiKey.placeholder = providers.gemini?.api_key_configured ? "已配置，留空保留" : "粘贴 Gemini API Key";
    form.openaiBaseUrl.value = providers.openai_compatible?.base_url ?? "";
    form.openaiModel.value = providers.openai_compatible?.model ?? "";
    form.openaiApiKey.placeholder = providers.openai_compatible?.api_key_configured ? "已配置，留空保留" : "粘贴 OpenAI 兼容 API Key";
    form.deepseekBaseUrl.value = providers.deepseek?.base_url ?? "";
    form.deepseekModel.value = providers.deepseek?.model ?? "";
    form.deepseekApiKey.placeholder = providers.deepseek?.api_key_configured ? "已配置，留空保留" : "粘贴 DeepSeek API Key";
    form.openrouterBaseUrl.value = providers.openrouter?.base_url ?? "";
    form.openrouterModel.value = providers.openrouter?.model ?? "";
    form.openrouterApiKey.placeholder = providers.openrouter?.api_key_configured ? "已配置，留空保留" : "粘贴 OpenRouter API Key";
    updateAiProviderStates(ai);
  }

  elements.feishuForm.appId.value = config.feishu?.app_id ?? "";
  elements.feishuForm.appSecret.placeholder = config.feishu?.app_secret_configured ? "已配置，留空保留" : "粘贴 App Secret";
  elements.feishuForm.appToken.value = config.feishu?.app_token ?? "";
  elements.feishuForm.tableId.value = config.feishu?.evaluation_table_id ?? "";
  elements.feishuForm.uploadScreenshots.checked = Boolean(config.feishu?.upload_screenshots);
}

function renderFieldComposerWorkbench() {
  const root = elements.fieldComposer;
  if (!root) return;
  const composer = state.fieldComposer;
  if (!composer) {
    root.innerHTML = `<div class="field-composer-empty">字段编排器读取中。</div>`;
    return;
  }
  const assigned = assignedFieldIds(composer);
  const fieldsById = new Map(composer.fields.map((field) => [field.id, field]));
  const activeFieldRefs = composer.categories
    .flatMap((category) => category.field_ids ?? [])
    .map((id) => fieldsById.get(id))
    .filter(Boolean);
  const inactiveFields = composer.fields.filter((field) => !assigned.has(field.id));
  const activeCount = activeFieldRefs.length;
  const diff = state.fieldComposerDiff;
  const suggestionWorkbench = state.taxonomySuggestions ?? {};
  root.innerHTML = `
    <div class="field-composer-head">
      <div>
        <span>飞书输出</span>
        <h2>输出字段与标签库</h2>
        <p>每个分类会对应一个飞书数据表，拖入分类的字段才会写入。</p>
      </div>
      <div class="button-row">
        <button class="button" data-field-composer-reset type="button">恢复默认</button>
        <button class="button" data-field-composer-save type="button">保存编排</button>
        <button class="button primary" data-field-composer-diff type="button">检查飞书差异</button>
      </div>
    </div>
    ${fieldComposerTaxonomyStrip()}
    ${fieldComposerCompatibilityStrip()}
    <div class="field-composer-stats">
      ${fieldComposerStat("分类表", composer.categories.length)}
      ${fieldComposerStat("写入字段", activeCount)}
      ${fieldComposerStat("未写入", inactiveFields.length)}
      ${fieldComposerStat("单选", activeFieldRefs.filter((field) => field.feishu_type === "single_select").length)}
      ${fieldComposerStat("多选", activeFieldRefs.filter((field) => field.feishu_type === "multi_select").length)}
    </div>
    <div class="field-composer-layout">
      <section class="field-pool" data-field-drop="unassigned">
        <div class="mini-panel-head"><span>总字段库</span><b>${inactiveFields.length} 个未写入</b></div>
        <div class="field-pool-list">
          ${inactiveFields.map((field) => fieldComposerCard(field, { unassigned: true })).join("") || `<div class="field-composer-empty">全部字段都已放入分类。</div>`}
        </div>
      </section>
      <section class="field-category-board">
        ${composer.categories.map((category) => fieldCategoryLane(category, composer)).join("")}
      </section>
    </div>
    ${fieldComposerDiffPanel(diff)}
    ${taxonomySuggestionReviewPanel(suggestionWorkbench)}
  `;
  bindFieldComposerActions(root);
}

function assignedFieldIds(composer) {
  return new Set((composer.categories ?? []).flatMap((category) => category.field_ids ?? []));
}

function fieldComposerStat(label, value) {
  return `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function fieldCategoryLane(category, composer) {
  const fieldsById = new Map(composer.fields.map((field) => [field.id, field]));
  const fields = (category.field_ids ?? []).map((id) => fieldsById.get(id)).filter(Boolean);
  return `<article class="field-category-lane" data-field-drop="${escapeAttr(category.id)}">
    <div class="field-category-head">
      <div>
        <span>${escapeHtml(category.label_zh)}</span>
        <input data-category-table-name="${escapeAttr(category.id)}" value="${escapeAttr(category.table_name)}" aria-label="${escapeAttr(category.label_zh)}表名">
      </div>
      <b>${escapeHtml(fields.length)} 字段</b>
    </div>
    <div class="field-category-list">
      ${fields.map((field) => fieldComposerCard(field, { categoryId: category.id })).join("") || `<div class="field-composer-empty">拖入字段到这里。</div>`}
    </div>
  </article>`;
}

function fieldComposerCard(field, options = {}) {
  const categoryId = options.categoryId || "";
  const action = options.unassigned
    ? `<button class="button small" data-field-add="${escapeAttr(field.id)}" type="button">加入</button>`
    : `<button class="button small" data-field-remove="${escapeAttr(field.id)}" type="button">移出</button>`;
  return `<article class="field-composer-card" draggable="true" data-field-id="${escapeAttr(field.id)}" data-category-id="${escapeAttr(categoryId)}">
    <div>
      <b>${escapeHtml(field.label_zh || field.field_name)}</b>
      <span>${escapeHtml(field.field_name)} · ${escapeHtml(field.source_path || "-")}</span>
    </div>
    <div class="field-card-controls">
      <select data-field-type="${escapeAttr(field.id)}" aria-label="${escapeAttr(field.label_zh || field.field_name)}字段类型">
        ${fieldTypeOptions(field.feishu_type)}
      </select>
      ${field.option_category ? `<i>${escapeHtml(taxonomyCategoryLabel(field.option_category))}</i>` : ""}
      ${action}
    </div>
  </article>`;
}

function fieldTypeOptions(current) {
  const types = [
    ["text", "文本"],
    ["long_text", "长文本"],
    ["number", "数字"],
    ["single_select", "单选"],
    ["multi_select", "多选"],
    ["checkbox", "勾选"],
    ["url", "链接"],
    ["attachment", "附件"],
  ];
  return types.map(([value, label]) => `<option value="${escapeAttr(value)}" ${current === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function bindFieldComposerActions(root) {
  root.querySelectorAll("[data-field-composer-save]").forEach((button) => {
    button.addEventListener("click", () => saveFieldComposer());
  });
  root.querySelectorAll("[data-field-composer-diff]").forEach((button) => {
    button.addEventListener("click", checkFieldComposerDiff);
  });
  root.querySelectorAll("[data-field-composer-reset]").forEach((button) => {
    button.addEventListener("click", resetFieldComposer);
  });
  root.querySelectorAll("[data-field-composer-apply]").forEach((button) => {
    button.addEventListener("click", applyFieldComposerSchema);
  });
  root.querySelectorAll("[data-field-taxonomy-sync]").forEach((button) => {
    button.addEventListener("click", () => startJob("taxonomy-sync"));
  });
  root.querySelectorAll("[data-taxonomy-review]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveTaxonomySuggestionReview(button.dataset.taxonomyReview, button.dataset.reviewStatus);
    });
  });
  root.querySelector("[data-taxonomy-writeback-preview]")?.addEventListener("click", buildTaxonomyWritebackPreview);
  root.querySelector("[data-taxonomy-writeback]")?.addEventListener("click", writeTaxonomySuggestionsToFeishu);
  root.querySelectorAll("[data-category-table-name]").forEach((input) => {
    input.addEventListener("input", () => {
      const category = state.fieldComposer?.categories?.find((item) => item.id === input.dataset.categoryTableName);
      if (category) category.table_name = input.value.trim();
    });
  });
  root.querySelectorAll("[data-field-type]").forEach((select) => {
    select.addEventListener("change", () => {
      const field = state.fieldComposer?.fields?.find((item) => item.id === select.dataset.fieldType);
      if (field) field.feishu_type = select.value;
      renderFieldComposerWorkbench();
    });
  });
  root.querySelectorAll("[data-field-add]").forEach((button) => {
    button.addEventListener("click", () => {
      moveFieldToCategory(button.dataset.fieldAdd, state.fieldComposer?.categories?.[0]?.id || "");
      renderFieldComposerWorkbench();
    });
  });
  root.querySelectorAll("[data-field-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      moveFieldToCategory(button.dataset.fieldRemove, "");
      renderFieldComposerWorkbench();
    });
  });
  root.querySelectorAll("[data-field-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", card.dataset.fieldId || "");
      event.dataTransfer?.setData("source/category", card.dataset.categoryId || "");
    });
  });
  root.querySelectorAll("[data-field-drop]").forEach((dropZone) => {
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
      const fieldId = event.dataTransfer?.getData("text/plain") || "";
      const categoryId = dropZone.dataset.fieldDrop === "unassigned" ? "" : dropZone.dataset.fieldDrop || "";
      moveFieldToCategory(fieldId, categoryId);
      renderFieldComposerWorkbench();
    });
  });
}

function moveFieldToCategory(fieldId, categoryId) {
  const composer = state.fieldComposer;
  if (!composer || !fieldId) return;
  for (const category of composer.categories) {
    category.field_ids = (category.field_ids ?? []).filter((id) => id !== fieldId);
  }
  if (!categoryId) return;
  const target = composer.categories.find((category) => category.id === categoryId);
  if (!target) return;
  target.field_ids = [...new Set([...(target.field_ids ?? []), fieldId])];
}

function fieldComposerTaxonomyStrip() {
  const taxonomy = state.status?.config?.taxonomy ?? {};
  const feishu = state.status?.config?.feishu ?? {};
  const ready = Number(taxonomy.option_count ?? 0) > 0;
  const tableReady = Boolean(feishu.taxonomy_table_id);
  const statusText = ready
    ? `已同步 ${taxonomy.option_count} 项`
    : tableReady
      ? "待同步"
      : "待配置标签表";
  const detailText = ready
    ? "玩法、题材、画风、特色标签等选项来自飞书。"
    : tableReady
      ? "点击同步后读取飞书里的单选和多选选项。"
      : "先在飞书连接里配置标签库表，再同步选项。";
  return `<div class="field-taxonomy-strip ${ready ? "good" : "warn"}">
    <div>
      <span>飞书标签库</span>
      <b>${escapeHtml(statusText)}</b>
      <small>${escapeHtml(detailText)}</small>
    </div>
    <button class="button small" data-field-taxonomy-sync type="button">同步标签库</button>
  </div>`;
}

function fieldComposerCompatibilityStrip() {
  const feishu = state.status?.config?.feishu ?? {};
  const warningCount = Number(feishu.fields_type_warnings ?? 0);
  if (!warningCount) return "";
  const names = (feishu.fields_type_warning_names ?? []).filter(Boolean).slice(0, 3).join("、") || "旧主表字段";
  return `<div class="field-taxonomy-strip warn">
    <div>
      <span>旧主表兼容提醒</span>
      <b>${escapeHtml(`${warningCount} 个类型提醒`)}</b>
      <small>${escapeHtml(`${names} 在旧评测主表里类型不同。v1.8 新写入以字段编排分类表为准；如果继续写旧主表，需要人工调整字段类型。`)}</small>
    </div>
    <button class="button small" data-field-composer-diff type="button">检查分类表</button>
  </div>`;
}

async function saveFieldComposer(options = {}) {
  if (!state.fieldComposer) return;
  const response = await fetchJson("/api/field-composer", {
    method: "POST",
    body: JSON.stringify({ composer: state.fieldComposer }),
  });
  state.fieldComposer = response.composer;
  state.fieldComposerDiff = response.last_diff ?? null;
  state.fieldComposerApply = response.last_apply ?? null;
  renderFieldComposerWorkbench();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
  if (!options.silent) appendConsole("字段编排已保存。");
}

async function checkFieldComposerDiff() {
  await saveFieldComposer({ silent: true });
  state.fieldComposerDiff = await fetchJson("/api/field-composer/diff", { method: "POST", body: "{}" });
  state.fieldComposerApply = null;
  renderFieldComposerWorkbench();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
  appendConsole(`字段差异检查完成：${displayValue(state.fieldComposerDiff.status)}`);
}

async function resetFieldComposer() {
  if (!window.confirm("恢复默认字段分类？当前本地字段编排会被覆盖，不会修改飞书。")) return;
  const response = await fetchJson("/api/field-composer/reset", { method: "POST", body: "{}" });
  state.fieldComposer = response.composer;
  state.fieldComposerDiff = response.last_diff ?? null;
  state.fieldComposerApply = response.last_apply ?? null;
  renderFieldComposerWorkbench();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
  appendConsole("字段编排已恢复默认。");
}

async function applyFieldComposerSchema() {
  const summary = state.fieldComposerDiff?.summary ?? {};
  const missingTables = summary.missing_tables ?? 0;
  const missingFields = summary.missing_fields ?? 0;
  if (!missingTables && !missingFields) {
    appendConsole("飞书结构没有需要新增的表或字段。");
    return;
  }
  const confirmed = window.confirm(
    `将在飞书新增 ${missingTables} 个数据表、${missingFields} 个字段。\n\n不会删除飞书已有字段，也不会修改已有字段类型。确认继续？`,
  );
  if (!confirmed) return;
  const response = await fetchJson("/api/field-composer/apply", {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  state.fieldComposerApply = response.result ?? null;
  state.fieldComposerDiff = response.diff ?? state.fieldComposerDiff;
  renderFieldComposerWorkbench();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
  const result = state.fieldComposerApply ?? {};
  appendConsole(`飞书结构同步：${displayValue(result.status)}；新建表 ${result.created_tables?.length ?? 0}，新建字段 ${result.created_fields?.length ?? 0}。`);
}

function fieldComposerDiffPanel(diff) {
  if (!diff) {
    return `<section class="field-diff-panel empty">
      <div><span>飞书差异预检</span><b>未检查</b><p>检查缺表、缺字段和类型冲突。</p></div>
    </section>`;
  }
  const summary = diff.summary ?? {};
  const tone = diff.status === "ready" ? "good" : diff.status === "blocked_type_conflict" || diff.status === "failed" ? "bad" : "warn";
  const canApply = diff.status === "needs_confirmation" && ((summary.missing_tables ?? 0) || (summary.missing_fields ?? 0));
  const applyResult = state.fieldComposerApply;
  return `<section class="field-diff-panel ${escapeAttr(tone)}">
    <div class="field-diff-head">
      <div><span>飞书差异预检</span><b>${escapeHtml(fieldComposerStatusLabel(diff.status))}</b><p>${escapeHtml((diff.next_prompt ?? []).join(" "))}</p></div>
      ${pill(fieldComposerStatusLabel(diff.status), tone)}
    </div>
    <div class="field-diff-metrics">
      ${fieldComposerStat("缺表", summary.missing_tables ?? 0)}
      ${fieldComposerStat("缺字段", summary.missing_fields ?? 0)}
      ${fieldComposerStat("类型冲突", summary.type_conflicts ?? 0)}
      ${fieldComposerStat("飞书多余字段", summary.extra_remote_fields ?? 0)}
    </div>
    <div class="field-diff-list">
      ${diffRows("需要新建表", diff.missing_tables, (item) => `${item.table_name} · ${item.expected_field_count} 字段`)}
      ${diffRows("需要新建字段", diff.missing_fields, (item) => `${item.table_name} / ${item.field_name} · ${fieldTypeLabel(item.expected_type)}`)}
      ${diffRows("类型冲突", diff.type_conflicts, (item) => `${item.table_name} / ${item.field_name} · 工具 ${fieldTypeLabel(item.expected_type)}，飞书 ${item.remote_type_label}`)}
      ${diffRows("飞书已有但本次不写", diff.extra_remote_fields, (item) => `${item.table_name} / ${item.field_name} · 保留为空`)}
    </div>
    ${canApply ? `<div class="field-diff-actions">
      <button class="button primary" data-field-composer-apply type="button">确认创建缺失表/字段</button>
      <span>只新增，不删除，不改类型。</span>
    </div>` : ""}
    ${applyResult ? `<div class="field-apply-note">
      上次同步：${escapeHtml(fieldApplyStatusLabel(applyResult.status))} · 新建表 ${escapeHtml(applyResult.created_tables?.length ?? 0)} · 新建字段 ${escapeHtml(applyResult.created_fields?.length ?? 0)}${applyResult.failed_items?.length ? ` · 失败 ${escapeHtml(applyResult.failed_items.length)}` : ""}
    </div>` : ""}
  </section>`;
}

function diffRows(title, items = [], format) {
  const visible = items.slice(0, 8);
  if (!visible.length) return "";
  const more = items.length > visible.length ? `<li>还有 ${escapeHtml(items.length - visible.length)} 项</li>` : "";
  return `<div><b>${escapeHtml(title)}</b><ul>${visible.map((item) => `<li>${escapeHtml(format(item))}</li>`).join("")}${more}</ul></div>`;
}

function fieldTypeLabel(type) {
  return {
    text: "文本",
    long_text: "长文本",
    number: "数字",
    single_select: "单选",
    multi_select: "多选",
    checkbox: "勾选",
    url: "链接",
    attachment: "附件",
  }[type] || type || "-";
}

function fieldComposerStatusLabel(status) {
  return {
    ready: "结构匹配",
    needs_confirmation: "需二次确认",
    blocked_type_conflict: "类型冲突",
    needs_feishu_config: "待配置飞书",
    failed: "检查失败",
  }[status] || status || "未检查";
}

function fieldApplyStatusLabel(status) {
  return {
    created: "已创建",
    partial_failed: "部分失败",
    failed: "失败",
    nothing_to_create: "无需新增",
    blocked_type_conflict: "类型冲突",
    needs_feishu_config: "待配置飞书",
    confirmation_required: "待确认",
  }[status] || status || "未知";
}

function renderSetupGuide() {
  const steps = setupStepsData();
  const completed = steps.filter((step) => step.done).length;
  const percent = steps.length ? Math.round((completed / steps.length) * 100) : 0;
  if (elements.setupProgressText) elements.setupProgressText.textContent = `${completed}/${steps.length} 已完成`;
  if (elements.setupMeter) elements.setupMeter.style.width = `${percent}%`;
  if (elements.setupSteps) {
    elements.setupSteps.innerHTML = steps.map((step, index) => setupStepMarkup(step, index)).join("");
    bindSetupActions();
  }
}

function setupStepsData() {
  const config = state.status.config ?? {};
  const ai = aiConfig(config);
  const activeAi = activeAiProvider(ai);
  const feishu = config.feishu ?? {};
  const hasBitableTarget = Boolean(feishu.app_token && feishu.evaluation_table_id);
  const taxonomyCount = Number(config.taxonomy?.option_count ?? 0);
  const fieldState = fieldComposerWriteReadiness();
  return [
    {
      title: "填写 AI 模型",
      detail: activeAi?.api_key_configured ? `已配置 ${aiProviderLabel(ai.active_provider)} · ${activeAi.model || "默认模型"}` : "选择供应商并填写 API Key。",
      done: Boolean(activeAi?.api_key_configured),
      action: { label: "去填写", scroll: "config" },
    },
    {
      title: "测试可用模型",
      detail: activeAi?.runtime_ready ? (activeAi.latest_check_status === "ok" ? "连接测试通过。" : "确认 API Key、代理和模型能正常调用。") : "当前评测链路暂只接入 Gemini，其他供应商先保存配置。",
      done: Boolean(activeAi?.runtime_ready && activeAi.latest_check_status === "ok"),
      action: { label: "测试", job: "gemini-test" },
    },
    {
      title: "填写飞书凭证",
      detail: feishu.app_id_configured && feishu.app_secret_configured ? "App ID 和 App Secret 已保存。" : "填写 App ID / App Secret，Secret 不会在界面回显。",
      done: Boolean(feishu.app_id_configured && feishu.app_secret_configured),
      action: { label: "去填写", scroll: "config" },
    },
    {
      title: "指定多维表格",
      detail: hasBitableTarget ? `表格 ${feishu.evaluation_table_id}` : "粘贴多维表格 URL，或填写 app_token 和 table_id。",
      done: hasBitableTarget,
      action: { label: "去填写", scroll: "config" },
    },
    {
      title: "检查飞书连接",
      detail: feishu.ready ? "飞书凭证和目标表格已通过检查。" : "确认 App 权限、App Token 和 Table ID 能正常访问。",
      done: Boolean(feishu.ready),
      action: { label: "检查", job: "feishu-check" },
    },
    {
      title: "同步飞书标签库",
      detail: taxonomyCount ? `已同步 ${taxonomyCount} 项。` : "读取玩法、题材、画风、特色标签等单选和多选选项。",
      done: taxonomyCount > 0,
      action: feishu.taxonomy_table_id
        ? { label: "同步", job: "taxonomy-sync" }
        : { label: "去填写", scroll: "config" },
    },
    {
      title: "检查输出字段",
      detail: fieldState.ok ? "飞书分类表和字段结构已匹配。" : fieldState.detail,
      done: Boolean(fieldState.ok),
      action: fieldState.action || { label: "去配置", scroll: "config" },
    },
  ];
}

function buildExperienceTestReadiness() {
  const config = state.status?.config ?? {};
  const games = state.status?.games ?? [];
  const ai = aiConfig(config);
  const activeAi = activeAiProvider(ai);
  const feishu = config.feishu ?? {};
  const taxonomyCount = Number(config.taxonomy?.option_count ?? 0);
  const fieldState = fieldComposerWriteReadiness();
  const suggestions = state.taxonomySuggestions?.summary ?? {};
  const pendingSuggestions = Number(suggestions.pending ?? 0);
  const acceptedSuggestions = Number(suggestions.accepted_actionable ?? 0);
  const previewRecordCount = Number(state.taxonomyWritebackPreview?.record_count ?? 0);
  const writebackStatus = state.taxonomyWritebackResult?.status || "";
  const readyGames = games.filter((game) => gameHealth(game).done).length;
  const evidenceGames = games.filter((game) => gameHealth(game).evidenceReady).length;
  const dryRun = state.status?.batch?.dry_run ?? null;
  const latestRun = state.status?.batch?.last_run ?? null;
  const uploadEnabled = Boolean(feishu.upload_screenshots);
  const screenshotUploadStatuses = games
    .map((game) => game.screenshot_upload_status || game.screenshot_upload?.status || "")
    .filter(Boolean);
  const uploadedCount = screenshotUploadStatuses.filter((status) => ["ready_for_upload", "uploaded", "partial_failed"].includes(status)).length;
  const screenshotTone = uploadEnabled
    ? uploadedCount
      ? (screenshotUploadStatuses.includes("partial_failed") ? "warn" : "good")
      : "warn"
    : "warn";
  const taxonomyAction = taxonomyReadinessAction({ pendingSuggestions, acceptedSuggestions, previewRecordCount, writebackStatus });
  const taxonomyDetail = taxonomyReadinessDetail({ pendingSuggestions, acceptedSuggestions, previewRecordCount, writebackStatus });
  const screenshotAction = !evidenceGames
    ? { label: "去采集", scroll: "runner", view: "workbench", mode: "queue" }
    : uploadEnabled
      ? { label: "去复核", scroll: "results", view: "workbench", mode: "review" }
      : { label: "去开启", scroll: "feishuForm", view: "config" };
  const rows = [
    readinessItem(
      activeAi?.runtime_ready && activeAi.latest_check_status === "ok" ? "good" : "bad",
      "AI 模型可调用",
      activeAi?.runtime_ready && activeAi.latest_check_status === "ok"
        ? `${aiProviderLabel(ai.active_provider)} 连接测试通过。`
        : "先让生产评测可调用模型，否则只能测本地兜底流程。",
      activeAi?.runtime_ready && activeAi.latest_check_status === "ok" ? null : { label: "测试", job: "gemini-test" },
    ),
    readinessItem(
      feishu.ready ? "good" : "bad",
      "飞书目标可写",
      feishu.ready ? `目标表：${feishu.evaluation_table_id || "已连接"}` : "先确认 App 权限、App Token 和目标表。真实测试要能看到写入结果。",
      feishu.ready ? null : { label: "检查", job: "feishu-check" },
    ),
    readinessItem(
      fieldState.ok ? "good" : "bad",
      fieldState.ok ? "输出字段已确认" : fieldState.label,
      fieldState.ok ? "拖入分类的字段会写入对应飞书数据表。" : fieldState.detail,
      fieldState.ok ? null : fieldState.action,
    ),
    readinessItem(
      taxonomyCount > 0 ? "good" : "bad",
      "标签库已同步",
      taxonomyCount > 0 ? `已读取 ${taxonomyCount} 个玩法、题材、画风或标签选项。` : "先从飞书 Taxonomy Options 读取单选和多选选项。",
      taxonomyCount > 0 ? null : (feishu.taxonomy_table_id ? { label: "同步", job: "taxonomy-sync" } : { label: "去配置", scroll: "config" }),
    ),
    readinessItem(
      taxonomyReadinessTone({ pendingSuggestions, acceptedSuggestions, previewRecordCount, writebackStatus }),
      "标签建议复核",
      taxonomyDetail,
      taxonomyAction,
    ),
    readinessItem(
      games.length ? (readyGames ? "good" : "warn") : "bad",
      "样本与单款结果",
      games.length
        ? readyGames
          ? `${games.length} 款样本，${readyGames} 款已完整跑通。`
          : `${games.length} 款样本，建议先完整跑通 1 款再扩大批量。`
        : "先导入至少一款游戏链接，再做体验测试。",
      games.length ? (readyGames ? null : { label: "开始运行", scroll: "runner" }) : { label: "导入", scroll: "runner" },
    ),
    readinessItem(
      dryRun ? "good" : "warn",
      "批量范围已预演",
      dryRun ? `${batchModeLabel(dryRun.mode)} · ${displayValue(dryRun.status || "-")}` : "真实批量前先预演队列，确认会跑哪些游戏。",
      dryRun ? null : { label: "预演", scroll: "runner" },
    ),
    readinessItem(
      evidenceGames && screenshotTone === "good" ? "good" : "warn",
      "截图与证据复核",
      evidenceGames
        ? uploadEnabled
          ? uploadedCount
            ? `${evidenceGames} 款可复核，${uploadedCount} 款有截图附件状态。`
            : `${evidenceGames} 款可复核，仍需验证飞书附件能否直接查看。`
          : `${evidenceGames} 款可复核；当前只写本地路径，不验证飞书附件预览。`
        : "还没有足够截图证据，先跑单款采集。",
      evidenceGames && screenshotTone === "good" ? null : screenshotAction,
    ),
  ];
  const blocking = rows.filter((item) => item.tone === "bad").length;
  const warnings = rows.filter((item) => item.tone === "warn").length;
  const passed = rows.filter((item) => item.tone === "good").length;
  const readiness = {
    tone: blocking ? "bad" : warnings ? "warn" : "good",
    title: blocking ? "先处理阻塞项" : warnings ? "可以小范围试跑" : "可以开始体验测试",
    detail: latestRun
      ? `最近运行：${batchModeLabel(latestRun.mode)} · ${displayValue(latestRun.status || "-")}`
      : "建议先按单款到小批量的顺序试跑。",
    blocking,
    warnings,
    passed,
    total: rows.length,
    rows,
  };
  readiness.copyText = buildExperienceReadinessCopyText(readiness);
  return readiness;
}

function readinessItem(tone, title, detail, action = null) {
  return { tone, title, detail, action };
}

function taxonomyReadinessAction({ pendingSuggestions, acceptedSuggestions, previewRecordCount, writebackStatus }) {
  if (taxonomyWritebackIsComplete(writebackStatus)) return pendingSuggestions ? { label: "去复核", scroll: "taxonomySuggestionReview", view: "config" } : null;
  if (taxonomyWritebackNeedsRetry(writebackStatus)) return { label: "重试", scroll: "taxonomySuggestionReview", view: "config" };
  if (previewRecordCount) return { label: "去写回", scroll: "taxonomySuggestionReview", view: "config" };
  if (acceptedSuggestions) return { label: "去生成", scroll: "taxonomySuggestionReview", view: "config" };
  if (pendingSuggestions) return { label: "去复核", scroll: "taxonomySuggestionReview", view: "config" };
  return null;
}

function taxonomyReadinessDetail({ pendingSuggestions, acceptedSuggestions, previewRecordCount, writebackStatus }) {
  if (taxonomyWritebackIsComplete(writebackStatus)) {
    const pendingText = pendingSuggestions ? ` 另有 ${pendingSuggestions} 条待审，可继续复核。` : "";
    return `标签建议已写回飞书：${taxonomyWritebackStatusLabel(writebackStatus)}。${pendingText}`;
  }
  if (taxonomyWritebackNeedsRetry(writebackStatus)) {
    return `上次写回${taxonomyWritebackStatusLabel(writebackStatus)}，请查看失败项后重试。`;
  }
  if (previewRecordCount) {
    const pendingText = pendingSuggestions ? ` 另有 ${pendingSuggestions} 条待审，可稍后处理。` : "";
    return `写回预览已有 ${previewRecordCount} 条，确认后再写回飞书。${pendingText}`;
  }
  if (acceptedSuggestions) {
    const pendingText = pendingSuggestions ? ` 另有 ${pendingSuggestions} 条待审。` : "";
    return `${acceptedSuggestions} 条已接受，写回前需要生成预览。${pendingText}`;
  }
  if (pendingSuggestions) return `${pendingSuggestions} 条待审，先决定是否加入标签库。`;
  return "暂无待处理新增标签。";
}

function taxonomyReadinessTone({ pendingSuggestions, acceptedSuggestions, previewRecordCount, writebackStatus }) {
  if (taxonomyWritebackIsComplete(writebackStatus)) return pendingSuggestions ? "warn" : "good";
  if (taxonomyWritebackNeedsRetry(writebackStatus)) return "warn";
  return pendingSuggestions || acceptedSuggestions || previewRecordCount ? "warn" : "good";
}

function buildExperienceReadinessCopyText(readiness) {
  const lines = [
    "H5 游戏评测助手体验测试摘要",
    `版本：${APP_VERSION_LABEL}`,
    `生成时间：${formatDateTime(new Date().toISOString())}`,
    `结论：${readiness.title}`,
    `说明：${readiness.detail}`,
    `状态：阻塞 ${readiness.blocking} / 待观察 ${readiness.warnings} / 通过 ${readiness.passed}/${readiness.total}`,
  ];
  for (const [groupLabel, tone] of [["阻塞项", "bad"], ["待观察项", "warn"], ["已通过项", "good"]]) {
    const rows = readiness.rows.filter((item) => item.tone === tone);
    lines.push("");
    lines.push(`${groupLabel}：${rows.length ? "" : "无"}`);
    for (const item of rows) {
      const action = item.action?.label ? `；建议动作：${item.action.label}` : "";
      lines.push(`- ${item.title}：${item.detail}${action}`);
    }
  }
  lines.push("");
  lines.push("反馈建议：先跑 1 款真实链接，再预演小批量；只记录真实卡点，不新增无关功能。");
  return lines.join("\n");
}

function renderStorageGuide() {
  if (!elements.storageRootText || !elements.storageEvidenceText || !elements.storageScreenshotText) return;
  const dataRoot = state.status?.data_root ?? "";
  const uploadScreenshots = Boolean(state.status?.config?.feishu?.upload_screenshots);
  elements.storageRootText.textContent = dataRoot
    ? `数据目录：${dataRoot}`
    : "数据目录读取中。";
  elements.storageEvidenceText.textContent = dataRoot
    ? `${dataRoot}\\evidence\\<game_id>\\`
    : "evidence/<game_id>/";
  elements.storageScreenshotText.textContent = uploadScreenshots
    ? "本地保存，同时上传飞书附件"
    : "本地保存，不上传飞书";
}

function renderFieldConfigWorkbench() {
  const root = elements.configWorkbench;
  if (!root) return;
  const workbench = state.configWorkbench;
  if (!workbench) {
    root.innerHTML = `<div class="config-empty">字段配置读取中。</div>`;
    return;
  }

  const fieldSummary = workbench.field_summary ?? {};
  const taxonomy = workbench.taxonomy_summary ?? {};
  const fields = workbench.fields ?? [];
  const categories = workbench.taxonomy_categories ?? [];
  const diagnostics = workbench.diagnostics ?? {};
  const templateAudit = workbench.template_audit ?? {};
  const suggestionWorkbench = state.taxonomySuggestions ?? {};
  const diagnosticItems = diagnostics.items ?? [];
  const issueFields = fields.filter((field) => field.issues?.length);
  const visibleFields = issueFields.length ? issueFields.slice(0, 8) : fields.slice(0, 8);

  root.innerHTML = `
    <div class="config-workbench-head">
      <div>
        <span>${APP_VERSION_LABEL}</span>
        <h2>字段与标签库</h2>
        <p>只读总览：先看清字段映射、飞书检查和标签库同步状态。</p>
      </div>
      <div class="button-row">
        <button class="button" data-config-job="feishu-fields" type="button">检查字段</button>
        <button class="button" data-config-job="taxonomy-sync" type="button">同步标签库</button>
      </div>
    </div>
    <div class="config-stat-grid">
      ${configStat("预期字段", fieldSummary.total_expected ?? 0, "field")}
      ${configStat("必填字段", fieldSummary.required ?? 0, "required")}
      ${configStat("飞书缺失", fieldSummary.missing_remote ?? 0, fieldSummary.missing_remote ? "bad" : "good")}
      ${configStat("类型风险", fieldSummary.type_warnings ?? 0, fieldSummary.type_warnings ? "warn" : "good")}
      ${configStat("标签选项", taxonomy.option_count ?? 0, "taxonomy")}
      ${configStat("模板状态", templateAudit.status_label ?? "待检查", templateAuditTone(templateAudit.status))}
    </div>
    ${autoplayStrategyPanel(state.status?.autoplay)}
    ${templateAuditStrip(templateAudit)}
    <div class="config-workbench-grid">
      <section class="config-mini-panel">
        <div class="mini-panel-head">
          <span>Field map</span>
          <b>${escapeHtml(fieldStatusLabel(fieldSummary.status))}</b>
        </div>
        <div class="field-map-list">
          ${visibleFields.map(fieldMapRow).join("") || `<div class="config-empty">暂无字段映射。</div>`}
        </div>
      </section>
      ${taxonomyManagerPanel(categories, taxonomy)}
      <section class="config-mini-panel config-diagnostics">
        <div class="mini-panel-head">
          <span>Diagnostics</span>
          <b>${escapeHtml(diagnostics.total ? `${diagnostics.total} 项` : "暂无阻断问题")}</b>
        </div>
        <div class="diagnostic-list">
          ${diagnosticItems.slice(0, 8).map(fieldDiagnosticRow).join("") || `<div class="config-empty">字段和标签库状态良好，暂未发现需要处理的诊断项。</div>`}
        </div>
        <div class="diagnostic-actions">
          <button class="button" data-copy-field-diagnostics type="button">复制诊断摘要</button>
        </div>
      </section>
    </div>
    ${taxonomySuggestionReviewPanel(suggestionWorkbench)}
  `;

  root.querySelectorAll("[data-config-job]").forEach((button) => {
    button.addEventListener("click", () => startJob(button.dataset.configJob));
  });
  root.querySelector("[data-copy-field-diagnostics]")?.addEventListener("click", async (event) => {
    await copyFieldDiagnostics(event.currentTarget, diagnostics.copy_text);
  });
  root.querySelector("[data-copy-template-audit]")?.addEventListener("click", async (event) => {
    await copyTextButton(event.currentTarget, templateAudit.copy_text, "复制模板摘要");
  });
  root.querySelector("[data-copy-autoplay-plan]")?.addEventListener("click", async (event) => {
    await copyTextButton(event.currentTarget, state.status?.autoplay?.copy_text, "复制 AI 玩家摘要");
  });
  bindTaxonomyManager(root, categories);
  root.querySelectorAll("[data-taxonomy-review]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveTaxonomySuggestionReview(button.dataset.taxonomyReview, button.dataset.reviewStatus);
    });
  });
  root.querySelector("[data-taxonomy-writeback-preview]")?.addEventListener("click", buildTaxonomyWritebackPreview);
  root.querySelector("[data-taxonomy-writeback]")?.addEventListener("click", writeTaxonomySuggestionsToFeishu);
}

function configStat(label, value, tone = "") {
  return `<div class="config-stat ${escapeAttr(tone)}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function templateAuditStrip(audit) {
  const tone = templateAuditTone(audit.status);
  const nextActions = audit.next_actions ?? [];
  const hash = audit.mapping_sha256 ? audit.mapping_sha256.slice(0, 12) : "-";
  const remoteHash = audit.remote_schema_sha256 ? audit.remote_schema_sha256.slice(0, 12) : "-";
  return `<section class="template-audit-strip ${escapeAttr(tone)}">
    <div class="template-audit-main">
      <span>Template audit</span>
      <b>${escapeHtml(audit.version || "未生成模板版本")}</b>
      <p>${escapeHtml(nextActions.length ? nextActions.join("；") : "字段映射、飞书远端字段和标签库当前可用于批量写入。")}</p>
    </div>
    <div class="template-audit-fingerprints">
      <div><span>Mapping</span><code>${escapeHtml(hash)}</code></div>
      <div><span>Remote</span><code>${escapeHtml(remoteHash)}</code></div>
      <div><span>Fields</span><code>${escapeHtml(`${audit.expected_fields ?? "-"} / ${audit.remote_fields ?? "-"}`)}</code></div>
    </div>
    <button class="button" data-copy-template-audit type="button">复制模板摘要</button>
  </section>`;
}

function templateAuditTone(status) {
  if (status === "aligned") return "good";
  if (["missing_fields", "failed"].includes(status)) return "bad";
  if (["type_warnings", "source_missing", "taxonomy_unchecked", "unchecked"].includes(status)) return "warn";
  return "";
}

function autoplayStrategyPanel(autoplay) {
  if (!autoplay) return "";
  const strategies = autoplay.strategies ?? [];
  const current = strategies.find((strategy) => strategy.id === autoplay.current_strategy) ?? strategies[0] ?? {};
  const profiles = autoplay.profiles ?? [];
  return `<section class="autoplay-strategy-panel">
    <div class="autoplay-strategy-head">
      <div>
        <span>AI Player</span>
        <b>${escapeHtml(autoplay.current_strategy_label || "自动试玩策略")}</b>
        <p>${escapeHtml(autoplay.note || "当前自动试玩使用浏览器启发式动作，后续可接多模态 AI 玩家。")}</p>
      </div>
      <div class="autoplay-readiness">
        ${configStat("默认档位", autoplay.current_profile || "-", "field")}
        ${configStat("动作记录", autoplay.latest_action_count ?? 0, autoplay.latest_action_count ? "good" : "warn")}
        ${configStat("多模态决策", autoplay.multimodal_ready ? "已预留" : "未开启", autoplay.multimodal_ready ? "good" : "warn")}
      </div>
    </div>
    <div class="autoplay-strategy-current">
      <div>
        <span>当前执行方式</span>
        <b>${escapeHtml(autoplay.action_provider || "Playwright heuristic")}</b>
        <p>${escapeHtml(current.description || "-")}</p>
      </div>
      <div>
        <span>API 消耗</span>
        <b>${escapeHtml(current.api_cost || "不额外消耗 AI API")}</b>
        <p>${escapeHtml(current.review_note || "-")}</p>
      </div>
      <button class="button" data-copy-autoplay-plan type="button">复制 AI 玩家摘要</button>
    </div>
    <div class="autoplay-strategy-grid">
      ${strategies.map(autoplayStrategyCard).join("")}
    </div>
    <div class="autoplay-profile-strip">
      ${profiles.map((profile) => `<span>${escapeHtml(profile.name)}：${escapeHtml(profile.strategy_label)} · ${escapeHtml(profile.total_play_seconds >= 60 ? `${Math.round(profile.total_play_seconds / 60)} 分钟` : `${profile.total_play_seconds} 秒`)}</span>`).join("") || "<span>暂无运行档位。</span>"}
    </div>
  </section>`;
}

function autoplayStrategyCard(strategy) {
  const tone = strategyTone(strategy);
  const profileText = strategy.used_by_profiles?.length ? strategy.used_by_profiles.join(", ") : "未绑定档位";
  return `<article class="autoplay-strategy-card ${escapeAttr(tone)} ${strategy.is_default ? "selected" : ""}">
    <div>
      <span>${escapeHtml(strategy.stage || "strategy")}</span>
      <b>${escapeHtml(strategy.label || strategy.id)}</b>
      <p>${escapeHtml(strategy.description || "-")}</p>
    </div>
    <div class="strategy-action-tags">
      ${(strategy.actions ?? []).slice(0, 5).map((action) => `<i>${escapeHtml(action)}</i>`).join("")}
    </div>
    <small>${escapeHtml(strategy.is_default ? "当前默认" : profileText)}</small>
  </article>`;
}

function strategyTone(strategy) {
  if (strategy?.tone === "good") return "good";
  if (strategy?.tone === "info") return "info";
  if (strategy?.tone === "warn") return "warn";
  return "";
}

function fieldMapRow(field) {
  const status = field.issues?.length
    ? field.issues.includes("missing_remote_field")
      ? "缺字段"
      : "需检查"
    : "匹配";
  const tone = field.issues?.length ? "warn" : "good";
  return `<div class="field-map-row ${escapeAttr(tone)}">
    <div>
      <b>${escapeHtml(field.field_name)}</b>
      <span>${escapeHtml(field.source_path || "-")}</span>
    </div>
    <em>${escapeHtml(field.feishu_type || "-")}</em>
    ${pill(status, tone)}
  </div>`;
}

function taxonomyManagerPanel(categories, taxonomy) {
  const options = filteredTaxonomyOptions(categories);
  const categoryOptions = categories.map((category) => `<option value="${escapeAttr(category.category)}" ${state.configTaxonomyFilter.category === category.category ? "selected" : ""}>${escapeHtml(taxonomyCategoryLabel(category.category))}</option>`).join("");
  return `<section class="config-mini-panel taxonomy-manager">
    <div class="mini-panel-head">
      <span>Taxonomy</span>
      <b><span id="taxonomyResultCount">${escapeHtml(options.length)}</span> / ${escapeHtml(taxonomy.option_count ?? 0)} 项</b>
    </div>
    <div class="taxonomy-controls">
      <input id="taxonomySearchInput" type="search" value="${escapeAttr(state.configTaxonomyFilter.query)}" placeholder="搜索标签名 / option id">
      <select id="taxonomyCategoryFilter">
        <option value="all">全部分类</option>
        ${categoryOptions}
      </select>
      <select id="taxonomyStatusFilter">
        <option value="all" ${state.configTaxonomyFilter.status === "all" ? "selected" : ""}>全部状态</option>
        <option value="enabled" ${state.configTaxonomyFilter.status === "enabled" ? "selected" : ""}>启用</option>
        <option value="disabled" ${state.configTaxonomyFilter.status === "disabled" ? "selected" : ""}>停用</option>
      </select>
    </div>
    <div class="taxonomy-category-strip">
      ${categories.map((category) => taxonomyCategoryChip(category)).join("") || `<span>暂无分类</span>`}
    </div>
    <div class="taxonomy-option-list" id="taxonomyOptionList">
      ${taxonomyOptionRows(options)}
    </div>
  </section>`;
}

function bindTaxonomyManager(root, categories) {
  const search = root.querySelector("#taxonomySearchInput");
  const category = root.querySelector("#taxonomyCategoryFilter");
  const status = root.querySelector("#taxonomyStatusFilter");
  search?.addEventListener("input", () => {
    state.configTaxonomyFilter.query = search.value;
    refreshTaxonomyOptionList(root, categories);
  });
  category?.addEventListener("change", () => {
    state.configTaxonomyFilter.category = category.value;
    refreshTaxonomyOptionList(root, categories);
  });
  status?.addEventListener("change", () => {
    state.configTaxonomyFilter.status = status.value;
    refreshTaxonomyOptionList(root, categories);
  });
  root.querySelectorAll("[data-taxonomy-category-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      state.configTaxonomyFilter.category = button.dataset.taxonomyCategoryChip || "all";
      const select = root.querySelector("#taxonomyCategoryFilter");
      if (select) select.value = state.configTaxonomyFilter.category;
      refreshTaxonomyOptionList(root, categories);
    });
  });
}

function refreshTaxonomyOptionList(root, categories) {
  const options = filteredTaxonomyOptions(categories);
  const list = root.querySelector("#taxonomyOptionList");
  const count = root.querySelector("#taxonomyResultCount");
  if (list) list.innerHTML = taxonomyOptionRows(options);
  if (count) count.textContent = String(options.length);
  root.querySelectorAll("[data-taxonomy-category-chip]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.taxonomyCategoryChip || "all") === state.configTaxonomyFilter.category);
  });
}

function filteredTaxonomyOptions(categories) {
  const query = state.configTaxonomyFilter.query.trim().toLowerCase();
  return flattenTaxonomyOptions(categories).filter((option) => {
    if (state.configTaxonomyFilter.category !== "all" && option.category !== state.configTaxonomyFilter.category) return false;
    if (state.configTaxonomyFilter.status === "enabled" && !option.enabled) return false;
    if (state.configTaxonomyFilter.status === "disabled" && option.enabled) return false;
    if (!query) return true;
    return [option.id, option.name_en, option.name_zh, option.description_zh, option.category]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

function flattenTaxonomyOptions(categories) {
  return categories.flatMap((category) => (category.options ?? category.sample_options ?? []).map((option) => ({
    ...option,
    category: category.category,
  })));
}

function taxonomyOptionRows(options) {
  const visible = options.slice(0, 36);
  const overflow = options.length > visible.length
    ? `<div class="taxonomy-option-more">还有 ${escapeHtml(options.length - visible.length)} 项，继续搜索可缩小范围。</div>`
    : "";
  return `${visible.map(taxonomyOptionRow).join("") || `<div class="config-empty">没有匹配的标签项。</div>`}${overflow}`;
}

function taxonomyOptionRow(option) {
  const primary = option.name_zh || option.name_en || option.id || "-";
  const secondary = option.name_zh && option.name_en ? option.name_en : option.description_zh || "-";
  return `<article class="taxonomy-option-row">
    <div>
      <b>${escapeHtml(primary)}</b>
      <span>${escapeHtml(taxonomyCategoryLabel(option.category))} · ${escapeHtml(option.id || "-")}</span>
    </div>
    <em>${escapeHtml(secondary)}</em>
    ${pill(option.enabled ? "启用" : "停用", option.enabled ? "good" : "warn")}
  </article>`;
}

function taxonomyCategoryChip(category) {
  const active = state.configTaxonomyFilter.category === category.category ? "active" : "";
  return `<button class="${escapeAttr(active)}" data-taxonomy-category-chip="${escapeAttr(category.category)}" type="button">
    <span>${escapeHtml(taxonomyCategoryLabel(category.category))}</span>
    <b>${escapeHtml(category.enabled)} / ${escapeHtml(category.total)}</b>
  </button>`;
}

function taxonomyCategoryLabel(category) {
  return {
    gameplay_types: "玩法",
    themes: "题材",
    art_styles: "画风",
    feature_tags: "特色标签",
    audiences: "人群",
    controls: "操作",
  }[category] || category;
}

function fieldDiagnosticRow(item) {
  const tone = diagnosticTone(item.severity);
  return `<div class="diagnostic-row ${escapeAttr(tone)}">
    <div>
      <b>${escapeHtml(item.field_name || "-")}</b>
      <span>${escapeHtml(item.message || item.issue || "-")}</span>
    </div>
    ${pill(item.severity || "info", tone)}
  </div>`;
}

function taxonomySuggestionReviewPanel(workbench) {
  const summary = workbench.summary ?? {};
  const items = workbench.items ?? [];
  const preview = state.taxonomyWritebackPreview;
  const writeback = state.taxonomyWritebackResult;
  const acceptedActionable = Number(summary.accepted_actionable ?? 0);
  const previewRecordCount = Number(preview?.record_count ?? 0);
  const writebackStatus = writeback?.status || "";
  const writebackComplete = taxonomyWritebackIsComplete(writebackStatus);
  const writebackRetry = taxonomyWritebackNeedsRetry(writebackStatus);
  const canPreview = acceptedActionable > 0 && !writebackComplete;
  const canWriteback = previewRecordCount > 0 && !writebackComplete;
  const previewButtonText = writebackComplete ? "已完成" : previewRecordCount ? "重新生成预览" : "生成写回预览";
  const writebackButtonText = writebackComplete ? "已写回" : writebackRetry ? "重试写回" : "写回飞书";
  const writebackText = writeback
    ? `飞书写回：${taxonomyWritebackStatusLabel(writeback.status)}，新建 ${writeback.created_count ?? 0}，补全 ${writeback.updated_count ?? 0}，跳过 ${writeback.skipped_count ?? 0}`
    : "真实写回只处理已接受项，写入前会查重。";
  const previewHint = preview
    ? `写回预览：${previewRecordCount} 条，${taxonomyPreviewStatusLabel(preview.status)}。${writebackText}`
    : acceptedActionable
      ? `已接受 ${acceptedActionable} 项，先生成写回预览再写回飞书。`
      : "先接受需要补充的标签建议，再生成写回预览。";
  return `<section class="config-mini-panel taxonomy-review-panel" id="taxonomySuggestionReview">
    <div class="mini-panel-head">
      <span>标签建议复核</span>
      <b>${escapeHtml(`${summary.pending ?? 0} 待审 / ${acceptedActionable} 已接受 / ${summary.total ?? 0} 总计`)}</b>
    </div>
    <div class="taxonomy-review-list">
      ${items.slice(0, 6).map(taxonomySuggestionRow).join("") || `<div class="config-empty">暂无新增标签建议。后续 AI 认为现有标签库不够时，会显示在这里。</div>`}
    </div>
    <div class="taxonomy-preview-actions">
      <span>${escapeHtml(previewHint)}</span>
      <div class="button-row">
        <button class="button" data-taxonomy-writeback-preview type="button" ${canPreview ? "" : "disabled"}>${escapeHtml(previewButtonText)}</button>
        <button class="button primary" data-taxonomy-writeback type="button" ${canWriteback ? "" : "disabled"}>${escapeHtml(writebackButtonText)}</button>
      </div>
    </div>
  </section>`;
}

function taxonomySuggestionRow(item) {
  const games = (item.games ?? []).map((game) => game.game_name || game.game_id).join("、");
  const statusTone = item.review_status === "accepted"
    ? "good"
    : item.review_status === "rejected"
      ? "bad"
      : item.review_status === "needs_info"
        ? "warn"
        : "";
  const actions = item.is_actionable
    ? `<div class="taxonomy-review-actions">
        <button class="button small" data-taxonomy-review="${escapeAttr(item.id)}" data-review-status="accepted" type="button">接受</button>
        <button class="button small" data-taxonomy-review="${escapeAttr(item.id)}" data-review-status="rejected" type="button">暂不加入</button>
        <button class="button small" data-taxonomy-review="${escapeAttr(item.id)}" data-review-status="needs_info" type="button">需补充</button>
      </div>`
    : `<span class="taxonomy-existing">已有选项：${escapeHtml(item.existing_option_id)}</span>`;
  return `<article class="taxonomy-review-row ${escapeAttr(statusTone)}">
    <div class="taxonomy-review-main">
      <span>${escapeHtml(taxonomySuggestionSourceLabel(item.source))} · ${escapeHtml(taxonomySuggestionCategoryLabel(item))} · ${escapeHtml(item.language)}</span>
      <b>${escapeHtml(item.suggestion)}</b>
      <p>${escapeHtml(item.reason || games || "无补充说明")}</p>
      <small>${escapeHtml(`${item.field || "-"} · ${games || "未关联游戏"}`)}</small>
    </div>
    <div class="taxonomy-review-side">
      ${pill(taxonomyReviewStatusLabel(item.review_status), statusTone)}
      ${actions}
    </div>
  </article>`;
}

function taxonomySuggestionSourceLabel(source) {
  if (source === "taxonomy_preflight") return "预检缺失";
  if (source === "ai") return "AI 建议";
  return source || "建议";
}

function taxonomySuggestionCategoryLabel(item) {
  if (item.category_label_zh) return item.category_label_zh;
  return taxonomyCategoryLabel(item.category || taxonomyCategoryFromFieldName(item.field)) || item.field || "标签";
}

function taxonomyCategoryFromFieldName(fieldName) {
  const key = String(fieldName ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  const categories = {
    audience: "audiences",
    target_audience: "audiences",
    game_type: "gameplay_types",
    sub_type: "gameplay_types",
    subgenre: "gameplay_types",
    theme: "themes",
    art_style: "art_styles",
    feature_tags: "feature_tags",
    controls: "controls",
  };
  return categories[key] || "";
}

async function saveTaxonomySuggestionReview(id, status) {
  await fetchJson("/api/taxonomy-suggestions/review", {
    method: "POST",
    body: JSON.stringify({ id, status }),
  });
  state.taxonomyWritebackPreview = null;
  state.taxonomyWritebackResult = null;
  state.taxonomySuggestions = await fetchJson("/api/taxonomy-suggestions");
  renderTaxonomySuggestionSurface();
}

async function buildTaxonomyWritebackPreview() {
  state.taxonomyWritebackPreview = await fetchJson("/api/taxonomy-suggestions/writeback-preview", {
    method: "POST",
    body: "{}",
  });
  state.taxonomyWritebackResult = null;
  renderTaxonomySuggestionSurface();
}

async function writeTaxonomySuggestionsToFeishu() {
  state.taxonomyWritebackResult = await fetchJson("/api/taxonomy-suggestions/writeback", {
    method: "POST",
    body: "{}",
  });
  const [status, taxonomySuggestions] = await Promise.all([
    fetchJson("/api/status").catch(() => state.status),
    fetchJson("/api/taxonomy-suggestions"),
  ]);
  state.status = status;
  state.taxonomySuggestions = taxonomySuggestions;
  state.taxonomyWritebackPreview = taxonomySuggestions?.writeback_preview ?? state.taxonomyWritebackPreview;
  state.taxonomyWritebackResult = taxonomySuggestions?.writeback_result ?? state.taxonomyWritebackResult;
  renderStatus();
  renderTaxonomySuggestionSurface();
}

function renderTaxonomySuggestionSurface() {
  renderFieldComposerWorkbench();
  renderRunGate();
  renderNextStep();
  renderContextPanel();
}

function taxonomyPreviewStatusLabel(status) {
  if (status === "ready_for_review") return "待确认";
  if (status === "empty") return "无可写入项";
  return status || "未生成";
}

function taxonomyWritebackStatusLabel(status) {
  if (status === "written") return "已写入";
  if (status === "updated") return "已补全";
  if (status === "skipped") return "全部跳过";
  if (status === "empty") return "无可写入项";
  if (status === "partial_failed") return "部分失败";
  if (status === "failed") return "失败";
  return status || "未执行";
}

function taxonomyWritebackIsComplete(status) {
  return ["written", "updated", "skipped", "empty"].includes(status);
}

function taxonomyWritebackNeedsRetry(status) {
  return ["partial_failed", "failed"].includes(status);
}

function taxonomyReviewStatusLabel(status) {
  if (status === "accepted") return "已接受";
  if (status === "rejected") return "暂不加入";
  if (status === "needs_info") return "需补充";
  return "待审核";
}

function diagnosticTone(severity) {
  if (severity === "bad") return "bad";
  if (severity === "warn") return "warn";
  return "";
}

async function copyFieldDiagnostics(button, text) {
  await copyTextButton(button, text || "暂无字段诊断信息。", "复制诊断摘要");
}

async function copyTextButton(button, text, fallbackLabel = "复制") {
  const content = text || "暂无可复制内容。";
  try {
    await navigator.clipboard.writeText(content);
    const previous = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = previous;
    }, 1300);
  } catch {
    state.consoleText = `${state.consoleText}\n${content}`.trim();
    renderJobs();
    if (button) button.textContent = fallbackLabel;
  }
}

function fieldStatusLabel(status) {
  if (status === "ready_for_write_test") return "字段就绪";
  if (status === "missing_fields") return "有缺失字段";
  if (status === "unchecked") return "未检查";
  return status || "未检查";
}

function taxonomyStatusLabel(status) {
  if (status === "synced") return "已同步";
  if (status === "empty") return "空标签库";
  if (status === "unchecked") return "未同步";
  return status || "未同步";
}

function setupStepMarkup(step, index) {
  const tone = step.done ? "done" : "pending";
  return `<li class="setup-step ${tone}">
    <div class="setup-index">${step.done ? "✓" : index + 1}</div>
    <div class="setup-body">
      <strong>${escapeHtml(step.title)}</strong>
      <span>${escapeHtml(step.detail)}</span>
    </div>
    ${step.done ? `<span class="setup-state">完成</span>` : setupActionMarkup(step.action)}
  </li>`;
}

function setupActionMarkup(action) {
  if (!action) return "";
  const attrs = [
    action.job ? `data-job="${escapeAttr(action.job)}"` : "",
    action.scroll ? `data-scroll="${escapeAttr(action.scroll)}"` : "",
    action.fieldDiff ? "data-field-diff=\"true\"" : "",
  ].filter(Boolean).join(" ");
  return `<button class="button small setup-action" type="button" ${attrs}>${escapeHtml(action.label)}</button>`;
}

function bindSetupActions() {
  $$(".setup-action").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.scroll;
      const job = button.dataset.job;
      if (target) activateSection(target);
      if (job) startJob(job);
      if (button.dataset.fieldDiff) checkFieldComposerDiff();
    });
  });
}

function renderRunProfiles() {
  const select = $("#runProfile");
  const note = $("#runProfileNote");
  const config = state.status.run_profiles ?? {};
  const profiles = config.profiles ?? {};
  const names = Object.keys(profiles);
  if (!names.length) {
    select.innerHTML = `<option value="">自定义</option>`;
    note.textContent = "未找到运行档位配置，可手动填写试玩秒数。";
    return;
  }

  const previous = select.value || config.default_profile || names[0];
  const current = profiles[previous]
    ? previous
    : profiles[config.default_profile]
      ? config.default_profile
      : names[0];
  select.innerHTML = names.map((name) => {
    const profile = profiles[name];
    const durationSeconds = Number(profile.total_play_seconds ?? profile.play_seconds ?? 0);
    const duration = durationSeconds >= 60
      ? `${Math.round(durationSeconds / 60)} 分钟`
      : `${durationSeconds} 秒`;
    return `<option value="${escapeAttr(name)}">${escapeHtml(name)} · ${escapeHtml(duration)}</option>`;
  }).join("");
  select.value = current;
  applyRunProfile(current);
}

function applyRunProfile(profileName) {
  const profile = state.status?.run_profiles?.profiles?.[profileName];
  const note = $("#runProfileNote");
  if (!profile) {
    note.textContent = "自定义运行参数。";
    return;
  }

  $("#playSeconds").value = profile.play_seconds ?? 60;
  $("#aiMode").value = profileAiMode(profile);
  $("#playStrategy").value = profile.play_strategy ?? "legacy_center_tap";
  renderRunProfileNote();
}

function renderRunProfileNote() {
  const profileName = $("#runProfile")?.value;
  const profile = state.status?.run_profiles?.profiles?.[profileName];
  const note = $("#runProfileNote");
  if (!profile || !note) return;
  const devices = Array.isArray(profile.devices) ? profile.devices.length : 0;
  const totalSeconds = Number(profile.total_play_seconds ?? profile.play_seconds ?? 0);
  const totalText = totalSeconds >= 60 ? `总计 ${Math.round(totalSeconds / 60)} 分钟` : `总计 ${totalSeconds} 秒`;
  const perDeviceText = profile.total_play_seconds ? `，每档位 ${profile.play_seconds ?? 0} 秒` : "";
  const trace = profile.trace ? `，trace: ${profile.trace}` : "";
  const video = profile.record_video ? `，本地视频 ${profile.video_seconds ?? 0} 秒` : "，不录视频";
  const strategy = `，自动试玩 ${playStrategyLabel(currentPlayStrategy(profile))}`;
  const strict = profile.fail_on_partial ? "，不完整则标记失败" : "";
  const retry = Number(profile.task_retries ?? 0) > 0 ? `，失败重试 ${profile.task_retries} 次` : "";
  note.textContent = `${profile.description ?? "运行档位"} · ${totalText}${perDeviceText} · ${devices || "-"} 个设备/网络组合${trace}${video}${strategy}${strict}${retry}`;
}

function profileAiMode(profile) {
  return String(profile.ai_mode ?? "").includes("gemini") ? "live" : "local";
}

function playStrategyLabel(value) {
  const labels = {
    passive: "只观察",
    legacy_center_tap: "安全点击",
    guided_probe: "引导探测",
    adaptive_probe: "AI 预留探测",
  };
  return labels[String(value ?? "")] ?? value ?? "-";
}

function currentPlayStrategy(profile = null) {
  return $("#playStrategy")?.value || profile?.play_strategy || "legacy_center_tap";
}

function currentRunProfileName() {
  return $("#runProfile")?.value || state.status?.run_profiles?.default_profile || "";
}

function currentRunProfile() {
  const profileName = currentRunProfileName();
  return state.status?.run_profiles?.profiles?.[profileName] ?? {};
}

function renderAutoplayPreflight() {
  if (!elements.autoplayPreflight) return;
  const preflight = buildAutoplayPreflight();
  elements.autoplayPreflight.innerHTML = autoplayPreflightMarkup(preflight);
  elements.autoplayPreflight.querySelector("[data-copy-autoplay-preflight]")?.addEventListener("click", async (event) => {
    await copyTextButton(event.currentTarget, preflight.copyText, "复制预检摘要");
  });
}

function renderGames() {
  const games = state.status.games ?? [];
  const overview = buildResultOverview(games);
  const visibleGames = games.filter((game) => matchesResultFilter(game, state.resultFilter));
  elements.gameSelect.innerHTML = games
    .map((game) => `<option value="${escapeAttr(game.game_id)}">${escapeHtml(game.game_name || game.game_id)}</option>`)
    .join("");
  if (state.selectedGameId && games.some((game) => game.game_id === state.selectedGameId)) {
    elements.gameSelect.value = state.selectedGameId;
  } else {
    state.selectedGameId = games[0]?.game_id ?? "";
    elements.gameSelect.value = state.selectedGameId;
  }

  renderResultOverview(overview);
  renderTableStatus(games, visibleGames);

  elements.gameTableBody.innerHTML = visibleGames.map((game) => {
    const selected = game.game_id === state.selectedGameId ? "selected" : "";
    const health = gameHealth(game);
    const quality = qualitySummary(qualitySignals(game));
    return `<tr class="game-row ${selected}" data-game-id="${escapeAttr(game.game_id)}">
      <td class="name-cell"><strong>${escapeHtml(game.game_name || game.game_id)}</strong><span>${escapeHtml(game.url)}</span></td>
      <td>${pill(game.collection_status || "missing", statusTone(game.collection_status))}</td>
      <td>${pill(game.evaluation_source || "missing", game.evaluation_source === "gemini" ? "good" : "warn")}</td>
      <td>${pill(game.feishu_write_status || game.feishu_preview_status || "missing", statusTone(game.feishu_write_status || game.feishu_preview_status))}</td>
      <td>${pill(quality.label, quality.tone)}</td>
      <td>${pill(health.reviewLabel, health.reviewTone)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6"><div class="empty-state compact">当前筛选下暂无游戏。</div></td></tr>`;

  $$(".game-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedGameId = row.dataset.gameId;
      elements.gameSelect.value = state.selectedGameId;
      renderGames();
    });
  });

  renderContextPanel();
}

function renderTableStatus(games, visibleGames) {
  if (!elements.tableStatus) return;
  const selected = selectedGame();
  const filterLabel = resultFilterLabel(state.resultFilter);
  elements.tableStatus.innerHTML = `
    <span>显示 ${visibleGames.length} / ${games.length} 款 · ${escapeHtml(filterLabel)}</span>
    <b>${escapeHtml(selected ? `选中：${selected.game_name || selected.game_id}` : "未选中游戏")}</b>
  `;
}

function renderResultOverview(overview) {
  const filters = [
    ["all", "全部", overview.total],
    ["review", "需复核", overview.needsReview],
    ["issue", "失败项", overview.issues],
  ];
  elements.resultOverview.innerHTML = filters.map(([key, label]) => `
    <button class="overview-chip ${state.resultFilter === key ? "active" : ""}" data-result-filter="${escapeAttr(key)}" type="button">
      <span>${escapeHtml(label)}</span><b>${escapeHtml(String(overviewCount(overview, key)))}</b>
    </button>
  `).join("");
  $$("[data-result-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.resultFilter = button.dataset.resultFilter;
      renderGames();
    });
  });
}

function overviewCount(overview, key) {
  if (key === "review") return overview.needsReview;
  if (key === "issue") return overview.issues;
  return overview.total;
}

function resultFilterLabel(key) {
  if (key === "review") return "需复核";
  if (key === "issue") return "失败项";
  return "全部";
}

function buildResultOverview(games) {
  const batch = latestBatchRecord(state.status?.batch);
  const health = games.map(gameHealth);
  return {
    total: games.length,
    done: health.filter((item) => item.done).length,
    needsReview: health.filter((item) => item.needsReview).length,
    issues: health.filter((item) => item.hasIssue).length,
    qualityWarnings: games.filter((game) => qualitySignals(game).length > 0).length,
    evidenceReady: health.filter((item) => item.evidenceReady).length,
    screenshotCount: games.reduce((sum, game) => sum + (game.screenshots?.length ?? 0), 0),
    videoCount: games.reduce((sum, game) => sum + (game.videos?.length ?? 0), 0),
    latestBatchText: batch
      ? `最近队列：${batchModeLabel(batch.mode)} / ${displayValue(batch.status || "-")} / ${batch.profile_name || "-"}`
      : "还没有批量队列记录",
  };
}

function matchesResultFilter(game, filter) {
  const health = gameHealth(game);
  if (filter === "done") return health.done;
  if (filter === "review") return health.needsReview;
  if (filter === "issue") return health.hasIssue;
  if (filter === "quality") return qualitySignals(game).length > 0;
  if (filter === "evidence") return health.evidenceReady;
  return true;
}

function gameHealth(game) {
  const collectionOk = game.collection_status === "collected";
  const aiOk = Boolean(game.evaluation_source);
  const feishuOk = ["updated", "written"].includes(game.feishu_write_status);
  const screenshotCount = game.screenshots?.length ?? 0;
  const expectedScreenshots = game.collection_quality?.expected_runs ?? 4;
  const evidenceReady = screenshotCount >= Math.min(4, expectedScreenshots || 4);
  const reviewStatus = game.review?.status ?? "pending";
  const qualityHasIssue = qualitySignals(game).some((signal) => signal.level === "bad");
  const hasIssue =
    !collectionOk ||
    !aiOk ||
    !feishuOk ||
    ["failed", "missing_fields"].includes(game.feishu_write_status) ||
    game.collection_status === "failed" ||
    qualityHasIssue;
  const needsReview = reviewStatus !== "approved" || !collectionOk || !evidenceReady || qualitySignals(game).length > 0;
  const done = collectionOk && aiOk && feishuOk && evidenceReady;
  const reviewLabel = reviewStatus === "approved" ? "已通过" : reviewStatus === "needs_changes" ? "需修改" : "待复核";
  const reviewTone = reviewStatus === "approved" ? "good" : reviewStatus === "needs_changes" ? "bad" : "warn";
  return { collectionOk, aiOk, feishuOk, evidenceReady, hasIssue, needsReview, done, reviewLabel, reviewTone };
}

function qualitySignals(game) {
  const signals = [];
  const collectionQuality = game.collection_quality ?? {};
  const result = game.ai_en?.result ?? {};
  const reviewText = [
    ...(game.ai_zh?.result?.review_notes ?? []),
    ...(game.ai_en?.result?.review_notes ?? []),
    ...(result.taxonomy_new_suggestions ?? []).map((item) => `${item.suggestion ?? ""} ${item.reason ?? ""}`),
  ].join(" ");

  if (game.collection_status && game.collection_status !== "collected") {
    addQualitySignal(signals, "bad", "采集未完整", `当前采集状态为 ${game.collection_status}`);
  }

  if ((collectionQuality.failed_runs ?? []).length > 0) {
    addQualitySignal(signals, "bad", "设备采集失败", `${collectionQuality.failed_runs.length} 个设备/网络档位失败`);
  }

  if ((collectionQuality.target_mismatched_runs ?? []).length > 0) {
    const excludedCount = collectionQuality.excluded_screenshot_count ?? 0;
    const extra = excludedCount ? `，已排除 ${excludedCount} 张截图` : "";
    addQualitySignal(signals, "warn", "目标游戏疑似不匹配", `${collectionQuality.target_mismatched_runs.length} 个档位跳到了其他游戏或页面${extra}`);
  }

  const screenshotCount = game.screenshots?.length ?? 0;
  const expectedScreenshots = Math.min(4, collectionQuality.expected_runs ?? 4);
  if (screenshotCount < expectedScreenshots) {
    addQualitySignal(signals, "warn", "截图不足", `已有 ${screenshotCount} 张，期望 ${expectedScreenshots} 张`);
  }
  for (const warning of collectionQuality.quality_warnings ?? []) {
    addQualitySignal(
      signals,
      warning.level || "warn",
      warning.title || "证据质量提示",
      warning.detail || warning.code || "需要人工确认采集证据是否可用",
    );
  }
  const autoplay = game.autoplay ?? {};
  if (["guided_probe", "adaptive_probe"].includes(autoplay.strategy) && (collectionQuality.autoplay_action_count ?? 0) === 0) {
    addQualitySignal(signals, "warn", "自动试玩未记录动作", "建议重跑采集或改用安全点击策略");
  }

  if (game.evaluation_source && game.evaluation_source !== "gemini") {
    addQualitySignal(signals, "warn", "AI 使用兜底结果", `当前来源为 ${game.evaluation_source}`);
  }

  const missingTaxonomyOptions = game.taxonomy_preflight?.missing_options ?? [];
  if (missingTaxonomyOptions.length > 0) {
    addQualitySignal(signals, "warn", "分类选项待补充", `${missingTaxonomyOptions.length} 个值不在飞书标签库中`);
  }

  if (!["updated", "written"].includes(game.feishu_write_status)) {
    addQualitySignal(signals, "bad", "飞书未完成写入", game.feishu_write_status || "未找到写入结果");
  }

  if (/广告|遮挡|弹窗|adver|obscur|overlay|pop[- ]?up/i.test(reviewText)) {
    addQualitySignal(signals, "warn", "广告或弹窗遮挡", "AI 或采集备注提到截图存在遮挡");
  }

  const lowConfidenceFields = lowConfidenceLabels(game);
  if (lowConfidenceFields.length > 0) {
    addQualitySignal(signals, "warn", "低置信度字段", lowConfidenceFields.slice(0, 4).join("、"));
  }

  const taxonomyReviewCount = taxonomyReviewCountFor(game);
  if (taxonomyReviewCount > 0) {
    addQualitySignal(signals, "warn", "标签需复核", `${taxonomyReviewCount} 个字段或建议需要确认`);
  }

  const unknownFields = unknownImportantFields(result);
  if (unknownFields.length > 0) {
    addQualitySignal(signals, "info", "关键信息未知", unknownFields.join("、"));
  }

  return signals;
}

function addQualitySignal(signals, level, title, detail) {
  if (signals.some((signal) => signal.title === title)) return;
  signals.push({ level, title, detail });
}

function qualitySummary(signals) {
  if (!signals.length) return { label: "清晰", tone: "good" };
  if (signals.some((signal) => signal.level === "bad")) return { label: `${signals.length} 项风险`, tone: "bad" };
  if (signals.some((signal) => signal.level === "warn")) return { label: `${signals.length} 项提示`, tone: "warn" };
  return { label: `${signals.length} 项备注`, tone: "" };
}

function lowConfidenceLabels(game) {
  const labels = [];
  const fieldNames = {
    device_fit: "设备适配",
    audience: "适合人群",
    game_mode: "游戏模式",
    game_type: "游戏类型",
    sub_type: "细分类型",
    theme: "题材",
    art_style: "画风",
    feature_tags: "特色标签",
    orientation: "横竖版",
    tutorial: "新手引导",
    responsive: "自适配",
    controls: "操作",
  };
  const zhResult = game.ai_zh?.result ?? {};
  for (const [key, label] of Object.entries(fieldNames)) {
    const confidence = Number(zhResult[key]?.confidence ?? NaN);
    if (Number.isFinite(confidence) && confidence > 0 && confidence < 0.55) labels.push(label);
  }
  return labels;
}

function taxonomyReviewCountFor(game) {
  let count = 0;
  const zhResult = game.ai_zh?.result ?? {};
  for (const value of Object.values(zhResult)) {
    if (value && typeof value === "object" && value.needs_taxonomy_review) count += 1;
  }
  count += game.ai_en?.result?.taxonomy_new_suggestions?.length ?? 0;
  return count;
}

function unknownImportantFields(result) {
  const fields = [
    ["game_mode", "游戏模式"],
    ["game_type", "游戏类型"],
    ["subgenre", "细分类型"],
    ["orientation", "横竖版"],
    ["tutorial", "新手引导"],
    ["responsive_layout", "自适配"],
  ];
  return fields
    .filter(([key]) => isUnknownValue(result[key]))
    .map(([, label]) => label);
}

function isUnknownValue(value) {
  if (Array.isArray(value)) return !value.length || value.every(isUnknownValue);
  return ["", "-", "unknown", "未知", "n/a", "null"].includes(String(value ?? "").trim().toLowerCase());
}

function qualityPanel(signals) {
  if (!signals.length) {
    return `<div class="quality-panel good">
      <div>
        <h3>质量提示</h3>
        <p>未发现明显采集、AI 或飞书写入风险。</p>
      </div>
      <span class="quality-badge good">清晰</span>
    </div>`;
  }
  const summary = qualitySummary(signals);
  return `<div class="quality-panel ${summary.tone}">
    <div>
      <h3>质量提示</h3>
      <p>优先处理红色风险，再人工确认黄色提示。</p>
    </div>
    <span class="quality-badge ${summary.tone}">需人工确认</span>
    <div class="quality-list">
      ${signals.map((signal) => `<div class="quality-item ${escapeAttr(signal.level)}">
        <strong>${escapeHtml(signal.title)}</strong>
        <span>${escapeHtml(signal.detail || qualityLevelLabel(signal.level))}</span>
      </div>`).join("")}
    </div>
  </div>`;
}

function qualityLevelLabel(level) {
  if (level === "bad") return "需要优先处理";
  if (level === "warn") return "建议人工确认";
  return "备注";
}

function qualityNotesText(signals) {
  if (!signals.length) return "";
  return signals.map((signal) => `- ${signal.title}: ${signal.detail || qualityLevelLabel(signal.level)}`).join("\n");
}

function renderBatchSummary() {
  const history = batchHistory();
  const batch = latestBatchRecord(state.status?.batch) ?? history[0];
  const production = batchProductionOverview();
  updateQueueControls();
  if (!batch) {
    elements.batchSummary.innerHTML = `
      ${queueEditorMarkup()}
      ${productionOverviewMarkup(production)}
      <div class="empty-state">暂无批量任务。先预演队列确认会跑哪些游戏。</div>`;
    bindBatchSummaryActions();
    return;
  }

  const totals = batch.totals ?? {};
  const rows = batch.tasks ?? [];
  const retryIds = batchRetryGameIds(batch);
  const resumeIds = batchResumeGameIds(batch);
  const active = rows.find((task) => task.status === "running");
  const title = active
    ? `运行中：${active.index}/${active.total} ${active.game_id}`
    : `${batchModeLabel(batch.mode || "batch")} · ${displayValue(batch.status || "-")} · ${batch.profile_name || "-"}`;
  const counts = [
    `成功 ${totals.success ?? 0}`,
    `失败 ${totals.failed ?? 0}`,
    `跳过 ${totals.skipped ?? 0}`,
    `计划 ${totals.queued ?? rows.length}`,
    `重试 ${batch.options?.task_retries ?? 0}`,
  ].join(" / ");
  const taskRows = rows.length
    ? `<div class="batch-task-list">${rows.slice(0, 10).map(batchTaskRow).join("")}${rows.length > 10 ? `<div class="batch-more">还有 ${rows.length - 10} 项未展开</div>` : ""}</div>`
    : "";
  const archive = batch.archive_dir ? `<span>${escapeHtml(`归档：${batch.archive_dir}`)}</span>` : "";
  const estimate = currentBatchEstimate();
  const historyRows = history.length
    ? `<div class="batch-history">
      <div class="batch-history-head"><strong>批次历史</strong><span>${history.length} 次</span></div>
      ${history.slice(0, 8).map(batchHistoryRow).join("")}
    </div>`
    : `<div class="empty-state">暂无历史批次。</div>`;
  elements.batchSummary.innerHTML = `
    ${queueEditorMarkup()}
    ${productionOverviewMarkup(production)}
    <div class="batch-overview">
      <div>
        <span>最近批量</span>
        <strong>${escapeHtml(title)}</strong>
        <em>${escapeHtml(counts)}</em>
        ${estimate ? `<em>${escapeHtml(`预计基础耗时 ${formatDuration(estimate.totalMs)} · ${estimate.count} 款`)}</em>` : ""}
        ${archive}
      </div>
      <div class="batch-overview-actions">
        <button class="button small" data-batch-latest-report type="button">导出报告</button>
        ${resumeIds.length ? `<button class="button small" data-batch-latest-resume type="button">填未完成项</button>` : ""}
        ${retryIds.length ? `<button class="button small" data-batch-latest-failed type="button">填失败项</button>` : ""}
      </div>
    </div>
    ${estimate ? batchEstimateMarkup(estimate) : ""}
    ${taskRows}
    ${historyRows}`;
  bindBatchSummaryActions();
}

function queueEditorMarkup() {
  const ids = selectedBatchGameIds();
  if (!ids.length) {
    const total = state.status?.games?.length ?? 0;
    return `<section class="queue-edit-summary empty">
      <div><b>当前队列为空</b><span>这里没有可删除项。运行或预演时会默认使用全部样本${total ? `（${total} 款）` : ""}；如只跑单款，请点“当前”。</span></div>
    </section>`;
  }
  return `<section class="queue-edit-summary">
    <div><b>当前队列</b><span>${ids.length} 款游戏，可单项移除或清空输入框。</span></div>
    <div class="queue-edit-chips">
      ${ids.slice(0, 12).map((id) => `<button class="queue-chip" data-remove-queue-id="${escapeAttr(id)}" type="button"><span>${escapeHtml(id)}</span><i>×</i></button>`).join("")}
      ${ids.length > 12 ? `<em>还有 ${escapeHtml(ids.length - 12)} 项</em>` : ""}
    </div>
  </section>`;
}

function renderBatchHistoryPanel() {
  if (!elements.batchHistoryPanel) return;
  const history = batchHistory();
  if (!history.length) {
    elements.batchHistoryPanel.innerHTML = `<div class="batch-history-empty">暂无批次历史。运行或预演后会在这里出现记录。</div>`;
    return;
  }
  const filtered = filteredBatchHistory(history);
  elements.batchHistoryPanel.innerHTML = `
    <div class="batch-history-title">
      <div><strong>批次历史</strong><span id="batchHistoryFilteredCount">${filtered.length}/${history.length} 次</span></div>
      <span>未完成/失败项可直接回填到队列</span>
    </div>
    <div class="batch-history-filters" aria-label="批次历史筛选">
      <div class="batch-filter-group" aria-label="按状态筛选">
        ${batchFilterButton("status", "all", "全部")}
        ${batchFilterButton("status", "need_resume", "未完成")}
        ${batchFilterButton("status", "failed", "失败")}
        ${batchFilterButton("status", "cancelled", "已取消")}
        ${batchFilterButton("status", "success", "成功")}
      </div>
      <div class="batch-filter-group" aria-label="按类型筛选">
        ${batchFilterButton("mode", "all", "全部类型")}
        ${batchFilterButton("mode", "execute", "执行")}
        ${batchFilterButton("mode", "dry_run", "预演")}
      </div>
      <label class="batch-history-search">
        <span>搜索</span>
        <input id="batchHistorySearch" type="search" value="${escapeAttr(state.batchHistoryFilters.query)}" placeholder="game_id / 档位 / 状态">
      </label>
      <button class="button small" data-batch-filter-reset type="button">清除</button>
    </div>
    <div class="batch-history-main-list" id="batchHistoryMainList">
      ${batchHistoryMainListHtml(filtered)}
    </div>`;
  bindBatchHistoryPanelActions();
}

function batchFilterButton(kind, value, label) {
  const active = state.batchHistoryFilters[kind] === value ? " active" : "";
  return `<button class="batch-filter${active}" data-batch-filter-kind="${escapeAttr(kind)}" data-batch-filter-value="${escapeAttr(value)}" type="button">${escapeHtml(label)}</button>`;
}

function bindBatchHistoryPanelActions() {
  elements.batchHistoryPanel.querySelectorAll("[data-batch-filter-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.batchFilterKind;
      if (!kind) return;
      state.batchHistoryFilters[kind] = button.dataset.batchFilterValue || "all";
      renderBatchHistoryPanel();
    });
  });
  elements.batchHistoryPanel.querySelector("[data-batch-filter-reset]")?.addEventListener("click", () => {
    state.batchHistoryFilters = { status: "all", mode: "all", query: "" };
    renderBatchHistoryPanel();
  });
  elements.batchHistoryPanel.querySelector("#batchHistorySearch")?.addEventListener("input", (event) => {
    state.batchHistoryFilters.query = event.target.value;
    renderBatchHistoryMainList();
  });
  bindBatchHistoryRowActions();
}

function bindBatchHistoryRowActions() {
  elements.batchHistoryPanel.querySelectorAll("[data-batch-history-main-detail]").forEach((button) => {
    button.addEventListener("click", () => selectBatchHistory(button.dataset.batchHistoryMainDetail));
  });
  elements.batchHistoryPanel.querySelectorAll("[data-batch-history-main-report]").forEach((button) => {
    button.addEventListener("click", () => exportBatchHistoryReport(button.dataset.batchHistoryMainReport));
  });
  elements.batchHistoryPanel.querySelectorAll("[data-batch-history-main-resume]").forEach((button) => {
    button.addEventListener("click", () => fillBatchHistoryResume(button.dataset.batchHistoryMainResume));
  });
  elements.batchHistoryPanel.querySelectorAll("[data-batch-history-main-failed]").forEach((button) => {
    button.addEventListener("click", () => fillBatchHistoryFailed(button.dataset.batchHistoryMainFailed));
  });
}

function renderBatchHistoryMainList() {
  const list = elements.batchHistoryPanel?.querySelector("#batchHistoryMainList");
  const count = elements.batchHistoryPanel?.querySelector("#batchHistoryFilteredCount");
  if (!list || !count) return;
  const history = batchHistory();
  const filtered = filteredBatchHistory(history);
  count.textContent = `${filtered.length}/${history.length} 次`;
  list.innerHTML = batchHistoryMainListHtml(filtered);
  bindBatchHistoryRowActions();
}

function batchHistoryMainListHtml(filtered) {
  if (!filtered.length) {
    return `<div class="batch-history-empty compact">没有匹配批次。换个状态、类型或关键词再看。</div>`;
  }
  return filtered.slice(0, 16).map(({ run, index }) => batchHistoryMainRow(run, index)).join("");
}

function batchTaskRow(task) {
  const status = task.status ?? "-";
  const tone = statusTone(status);
  const elapsed = task.elapsed_ms ? formatElapsed(task.elapsed_ms) : "";
  const attempts = task.attempts?.length ?? 0;
  const error = task.status === "failed" ? summarizeTaskError(task) : "";
  return `<div class="batch-task-row ${tone}">
    <div>
      <strong>${escapeHtml(task.game_id ?? "-")}</strong>
      <span>${escapeHtml([elapsed, task.exit_code !== null && task.exit_code !== undefined ? `exit ${task.exit_code}` : "", attempts > 1 ? `${attempts} attempts` : ""].filter(Boolean).join(" · "))}</span>
    </div>
    ${taskPill(status, tone)}
    ${error ? `<p>${escapeHtml(error)}</p>` : ""}
  </div>`;
}

function batchHistoryRow(run, index) {
  const totals = run.totals ?? {};
  const retryIds = batchRetryGameIds(run);
  const resumeIds = batchResumeGameIds(run);
  const tone = statusTone(run.status);
  const meta = [
    batchModeLabel(run.mode),
    run.profile_name || "-",
    formatDateTime(run.started_at),
    run.duration_ms ? formatElapsed(run.duration_ms) : "",
  ].filter(Boolean).join(" · ");
  const counts = `成功 ${totals.success ?? 0} / 失败 ${totals.failed ?? 0} / 计划 ${totals.queued ?? run.tasks?.length ?? 0}`;
  return `<div class="batch-history-row ${escapeAttr(tone)}">
    <div>
      <strong>${escapeHtml(displayValue(run.status || "-"))}</strong>
      <span>${escapeHtml(meta)}</span>
      <small>${escapeHtml(counts)}</small>
    </div>
    <div class="batch-history-actions">
      <button class="button small" data-batch-history-detail="${index}" type="button">详情</button>
      <button class="button small" data-batch-history-report="${index}" type="button">报告</button>
      ${resumeIds.length ? `<button class="button small" data-batch-history-resume="${index}" type="button">填未完成</button>` : ""}
      ${retryIds.length ? `<button class="button small" data-batch-history-failed="${index}" type="button">填失败项</button>` : ""}
      ${!resumeIds.length && !retryIds.length ? pill(run.status || "-", tone) : ""}
    </div>
  </div>`;
}

function batchHistoryMainRow(run, index) {
  const totals = run.totals ?? {};
  const retryIds = batchRetryGameIds(run);
  const resumeIds = batchResumeGameIds(run);
  const tone = statusTone(run.status);
  const meta = [
    batchModeLabel(run.mode),
    run.profile_name || "-",
    formatDateTime(run.started_at),
    run.duration_ms ? formatDuration(run.duration_ms) : "",
  ].filter(Boolean).join(" · ");
  const issueText = resumeIds.length
    ? `未完成：${resumeIds.join(", ")}`
    : retryIds.length
      ? `失败项：${retryIds.join(", ")}`
      : "无失败项";
  const active = state.selectedBatchHistoryIndex === index ? " active" : "";
  return `<div class="batch-history-main-row ${escapeAttr(tone)}${active}">
    <div>
      <strong>${escapeHtml(displayValue(run.status || "-"))}</strong>
      <span>${escapeHtml(meta)}</span>
    </div>
    <div class="batch-history-counts">
      <b>${escapeHtml(`${totals.success ?? 0}/${totals.queued ?? run.tasks?.length ?? 0}`)}</b>
      <span>${escapeHtml(issueText)}</span>
    </div>
    <div class="batch-history-actions">
      <button class="button small" data-batch-history-main-detail="${index}" type="button">详情</button>
      <button class="button small" data-batch-history-main-report="${index}" type="button">报告</button>
      ${resumeIds.length ? `<button class="button small" data-batch-history-main-resume="${index}" type="button">填未完成</button>` : ""}
      ${retryIds.length ? `<button class="button small" data-batch-history-main-failed="${index}" type="button">填失败项</button>` : ""}
      ${!resumeIds.length && !retryIds.length ? pill(run.status || "-", tone) : ""}
    </div>
  </div>`;
}

function bindBatchSummaryActions() {
  bindProductionRecoveryActions(elements.batchSummary);
  elements.batchSummary.querySelectorAll("[data-remove-queue-id]").forEach((button) => {
    button.addEventListener("click", () => removeBatchGameId(button.dataset.removeQueueId));
  });
  elements.batchSummary.querySelector("[data-batch-latest-resume]")?.addEventListener("click", () => fillBatchResume());
  elements.batchSummary.querySelector("[data-batch-latest-failed]")?.addEventListener("click", () => fillBatchFailed());
  elements.batchSummary.querySelector("[data-batch-latest-report]")?.addEventListener("click", () => exportBatchReport(latestBatchRecord(state.status?.batch)));
  elements.batchSummary.querySelectorAll("[data-batch-history-detail]").forEach((button) => {
    button.addEventListener("click", () => selectBatchHistory(button.dataset.batchHistoryDetail));
  });
  elements.batchSummary.querySelectorAll("[data-batch-history-report]").forEach((button) => {
    button.addEventListener("click", () => exportBatchHistoryReport(button.dataset.batchHistoryReport));
  });
  elements.batchSummary.querySelectorAll("[data-batch-history-resume]").forEach((button) => {
    button.addEventListener("click", () => fillBatchHistoryResume(button.dataset.batchHistoryResume));
  });
  elements.batchSummary.querySelectorAll("[data-batch-history-failed]").forEach((button) => {
    button.addEventListener("click", () => fillBatchHistoryFailed(button.dataset.batchHistoryFailed));
  });
}

function summarizeTaskError(task) {
  const text = String(task.stderr_tail || task.stdout_tail || "").trim();
  if (!text) return "未记录错误输出。";
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-3).join(" ");
}

function latestBatchRecord(batch) {
  const records = [batch?.last_run, batch?.dry_run].filter(Boolean);
  return records.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")))[0] ?? null;
}

function batchHistory() {
  return state.status?.batch?.history ?? [];
}

function batchProductionOverview() {
  return state.status?.batch?.production ?? null;
}

function productionOverviewMarkup(production, options = {}) {
  if (!production) return "";
  const compact = Boolean(options.compact);
  const totals = production.totals ?? {};
  const recovery = production.recovery_plan ?? {};
  const failures = production.recurrent_failures ?? [];
  const tone = production.tone || statusTone(production.status);
  const runCount = production.recent_window_count ?? 0;
  const executeCount = production.execute_run_count ?? 0;
  const successRate = executeCount ? `${production.success_rate ?? 0}%` : "-";
  const latestText = [
    displayValue(production.latest_execute_status || production.status || "-"),
    formatDateTime(production.latest_execute_finished_at || production.latest_execute_started_at),
  ].filter(Boolean).join(" · ");
  return `<section class="batch-production-overview ${escapeAttr(tone)} ${compact ? "compact" : ""}">
    <div class="batch-production-head">
      <div>
        <span>v1.8 批量生产总览</span>
        <strong>${escapeHtml(latestText || displayValue(production.status || "-"))}</strong>
        <em>${escapeHtml(production.note || "暂无批量生产建议。")}</em>
      </div>
      ${recovery.game_ids?.length ? `<button class="button small" data-production-recovery type="button">${escapeHtml(recovery.label || "填入恢复队列")}</button>` : pill(production.status || "-", tone)}
    </div>
    <div class="batch-production-metrics">
      ${productionMetric("近批次", `${runCount}/${executeCount}`, "")}
      ${productionMetric("成功率", successRate, successRate === "100%" ? "good" : totals.failed ? "warn" : "")}
      ${productionMetric("可恢复", String(recovery.game_ids?.length ?? 0), recovery.game_ids?.length ? "warn" : "good")}
      ${productionMetric("重试救回", String(totals.recovered_by_retry ?? 0), totals.recovered_by_retry ? "good" : "")}
    </div>
    ${productionRecoveryMarkup(recovery)}
    ${productionFailureMarkup(failures, compact)}
  </section>`;
}

function productionMetric(label, value, tone = "") {
  return `<div class="batch-production-metric ${escapeAttr(tone)}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function productionRecoveryMarkup(recovery = {}) {
  const ids = recovery.game_ids ?? [];
  if (!ids.length) {
    return `<div class="batch-production-recovery good">
      <div><b>恢复队列</b><span>最近执行批次没有未完成或失败项。</span></div>
      ${pill("无需恢复", "good")}
    </div>`;
  }
  const preview = ids.slice(0, 5).join(", ");
  const rest = ids.length > 5 ? ` 等 ${ids.length} 款` : "";
  return `<div class="batch-production-recovery warn">
    <div>
      <b>${escapeHtml(recovery.scope === "resume" ? "建议恢复未完成项" : "建议重跑失败项")}</b>
      <span>${escapeHtml(`${preview}${rest}`)}</span>
    </div>
    <button class="button small" data-production-recovery type="button">填入队列</button>
  </div>`;
}

function productionFailureMarkup(failures = [], compact = false) {
  const visible = failures.slice(0, compact ? 3 : 5);
  if (!visible.length) {
    return `<div class="batch-production-failures empty">暂无重复失败游戏。</div>`;
  }
  return `<div class="batch-production-failures">
    ${visible.map((item) => `<div class="batch-production-failure-row">
      <div>
        <b>${escapeHtml(item.game_id)}</b>
        <span>${escapeHtml([`${item.fail_count} 次失败`, item.profiles?.join("/") || "", formatDateTime(item.latest_failed_at)].filter(Boolean).join(" · "))}</span>
      </div>
      <small>${escapeHtml(item.latest_error || "无错误尾巴")}</small>
    </div>`).join("")}
  </div>`;
}

function selectedBatchForDetail() {
  const index = Number(state.selectedBatchHistoryIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  return batchHistory()[index] ?? null;
}

function selectBatchHistory(index) {
  const nextIndex = Number(index);
  if (!Number.isInteger(nextIndex) || !batchHistory()[nextIndex]) return;
  state.selectedBatchHistoryIndex = nextIndex;
  renderBatchHistoryPanel();
  renderContextPanel();
}

function filteredBatchHistory(history = batchHistory()) {
  return history
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => batchHistoryMatchesFilters(run));
}

function batchHistoryMatchesFilters(run) {
  const filters = state.batchHistoryFilters;
  const status = String(run?.status ?? "");
  if (filters.mode !== "all" && String(run?.mode ?? "") !== filters.mode) return false;
  if (filters.status === "need_resume" && !batchResumeGameIds(run).length) return false;
  if (filters.status === "failed" && status !== "failed" && !batchRetryGameIds(run).length) return false;
  if (filters.status === "cancelled" && !["cancelled", "cancelling"].includes(status)) return false;
  if (filters.status === "success" && status !== "success") return false;

  const query = String(filters.query ?? "").trim().toLowerCase();
  if (!query) return true;
  const text = [
    status,
    displayValue(status),
    run?.mode,
    batchModeLabel(run?.mode),
    run?.profile_name,
    run?.archive_dir,
    ...(run?.selected_game_ids ?? []),
    ...batchResumeGameIds(run),
    ...batchRetryGameIds(run),
    ...(run?.tasks ?? []).map((task) => `${task.game_id ?? ""} ${task.status ?? ""} ${displayTaskValue(task.status)}`),
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes(query);
}

function selectedGame() {
  return (state.status?.games ?? []).find((item) => item.game_id === state.selectedGameId) ?? null;
}

function contextMode() {
  if (state.currentView === "config") return "config";
  if (state.currentView === "guide") return "guide";
  if (state.currentWorkbenchMode === "queue") return "queue";
  if (state.currentWorkbenchMode === "library") return "library";
  if (state.currentWorkbenchMode === "review") return "review";
  return "workbench";
}

function renderContextPanel() {
  if (!elements.detailPanel) return;
  const mode = contextMode();
  const nextKey = contextScrollKey(mode);
  const previousKey = elements.detailPanel.dataset.contextScrollKey || "";
  const previousMain = elements.detailPanel.querySelector(".context-main");
  const previousScrollTop = previousMain?.scrollTop ?? 0;
  elements.detailPanel.dataset.context = mode;
  elements.detailPanel.dataset.contextScrollKey = nextKey;
  const renderers = {
    workbench: renderWorkbenchContext,
    queue: renderQueueContext,
    library: renderLibraryContext,
    review: renderReviewContext,
    config: renderConfigContext,
    guide: renderGuideContext,
  };
  elements.detailPanel.innerHTML = (renderers[mode] ?? renderWorkbenchContext)();
  bindContextPanelActions();
  renderRunGate();
  const nextMain = elements.detailPanel.querySelector(".context-main");
  if (nextMain && previousKey === nextKey && previousScrollTop > 0) {
    nextMain.scrollTop = previousScrollTop;
    requestAnimationFrame(() => {
      nextMain.scrollTop = previousScrollTop;
    });
  }
}

function contextScrollKey(mode) {
  if (mode === "library" || mode === "review") return `${mode}:${state.selectedGameId || ""}`;
  if (mode === "queue") return `${mode}:${state.selectedBatchHistoryIndex ?? ""}`;
  return mode;
}

function contextShell({ kicker, title, subtitle, chips = [], body = "", footer = "", variant = "" }) {
  return `<div class="context-body ${escapeAttr(variant)}">
    <header class="context-header">
      <div>
        <div class="context-kicker">${escapeHtml(kicker)}</div>
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      ${chips.length ? `<div class="context-chips">${chips.map(([label, tone]) => pill(label, tone)).join("")}</div>` : ""}
    </header>
    <div class="context-main">${body}</div>
    ${footer ? `<footer class="context-footer">${footer}</footer>` : ""}
  </div>`;
}

function renderWorkbenchContext() {
  const games = state.status?.games ?? [];
  const overview = buildResultOverview(games);
  const game = selectedGame();
  const preflight = buildAutoplayPreflight();
  const subtitle = game
    ? `当前选中：${game.game_name || game.game_id}`
    : "导入游戏后，这里会显示当前批次和选中游戏。";
  const body = `
    <div class="context-metrics">
      ${contextMetric("需复核", overview.needsReview, "warn")}
      ${contextMetric("失败项", overview.issues, overview.issues ? "bad" : "good")}
      ${contextMetric("证据完整", overview.evidenceReady, "good")}
      ${contextMetric("截图", overview.screenshotCount, "")}
    </div>
    <section class="context-section">
      <div class="context-section-head"><span>当前队列</span><b>${escapeHtml(overview.latestBatchText)}</b></div>
    </section>
    ${autoplayPreflightMarkup(preflight, { compact: true, copyable: false })}
    ${game ? selectedGamePreview(game, { shotLimit: 2 }) : contextEmpty("暂无选中游戏。")}
  `;
  return contextShell({
    kicker: "工作台",
    title: "运行概览",
    subtitle,
    chips: [[`${games.length} 款`, ""], [`${overview.qualityWarnings} 个提示`, overview.qualityWarnings ? "warn" : "good"]],
    body,
    footer: `<button class="button" data-panel-jump="results" data-panel-view="workbench" data-panel-mode="review" type="button">进入证据复核</button><button class="button primary" id="panelRunSelectedButton" type="button">开始运行</button>`,
    variant: "context-workbench",
  });
}

function renderQueueContext() {
  const batch = latestBatchRecord(state.status?.batch);
  const history = batchHistory();
  const production = batchProductionOverview();
  const detailBatch = selectedBatchForDetail() ?? batch;
  const latest = state.jobs[0];
  const running = state.jobs.filter((job) => ["running", "cancelling"].includes(job.status));
  const tasks = detailBatch?.tasks ?? [];
  const estimate = currentBatchEstimate();
  const preflight = buildAutoplayPreflight();
  const body = detailBatch ? `
    <div class="context-metrics">
      ${contextMetric("成功", detailBatch.totals?.success ?? 0, "good")}
      ${contextMetric("失败", detailBatch.totals?.failed ?? 0, (detailBatch.totals?.failed ?? 0) ? "bad" : "")}
      ${contextMetric("跳过", detailBatch.totals?.skipped ?? 0, "")}
      ${contextMetric("计划", detailBatch.totals?.queued ?? tasks.length, "")}
    </div>
    ${productionOverviewMarkup(production, { compact: true })}
    <section class="context-section">
      <div class="context-section-head"><span>${selectedBatchForDetail() ? "批次详情" : "最近批量"}</span><b>${escapeHtml(`${batchModeLabel(detailBatch.mode)} · ${displayValue(detailBatch.status || "-")} · ${detailBatch.profile_name || "-"}`)}</b></div>
      ${detailBatch.archive_dir ? `<p class="context-path">${escapeHtml(`归档：${detailBatch.archive_dir}`)}</p>` : ""}
      <div class="context-list">${tasks.slice(0, 10).map(contextTaskDetailRow).join("") || contextEmpty("暂无任务明细。")}</div>
    </section>
    ${estimate ? `<section class="context-section">
      <div class="context-section-head"><span>耗时估算</span><b>${escapeHtml(`${estimate.count} 款 · ${estimate.profileName}`)}</b></div>
      ${batchEstimateMarkup(estimate)}
    </section>` : ""}
    ${autoplayPreflightMarkup(preflight, { compact: true, copyable: false })}
    <section class="context-section">
      <div class="context-section-head"><span>批次历史</span><b>${history.length} 次</b></div>
      <div class="context-list">${history.slice(0, 5).map(contextBatchRunRow).join("") || contextEmpty("暂无历史批次。")}</div>
    </section>
    <section class="context-console">
      <b>任务输出</b>
      <pre>${escapeHtml(latestJobOutput())}</pre>
    </section>
  ` : `
    ${productionOverviewMarkup(production, { compact: true })}
    ${contextEmpty("还没有批量队列记录。先使用“预演队列”确认会跑哪些游戏。")}
    ${autoplayPreflightMarkup(preflight, { compact: true, copyable: false })}
    <section class="context-console"><b>任务输出</b><pre>${escapeHtml(latestJobOutput())}</pre></section>
  `;
  return contextShell({
    kicker: "任务队列",
    title: selectedBatchForDetail() ? "批次详情" : (running.length ? `${running.length} 个任务运行中` : "任务队列"),
    subtitle: latest ? `${latest.name}: ${displayValue(latest.status)}` : "批量、失败项、重试。",
    chips: [[running.length ? "运行中" : "空闲", running.length ? "warn" : "good"], production ? [`${production.success_rate ?? 0}% 成功率`, production.tone] : ["无历史", "warn"]],
    body,
    footer: `<button class="button" data-panel-jump="runner" data-panel-view="workbench" data-panel-mode="queue" type="button">编辑队列</button>${detailBatch ? `<button class="button" data-context-export-batch-report type="button">导出报告</button>` : ""}<button class="button primary" data-panel-jump="results" data-panel-view="workbench" data-panel-mode="queue" type="button">查看列表</button>`,
    variant: "context-queue",
  });
}

function renderLibraryContext() {
  const game = (state.status.games ?? []).find((item) => item.game_id === state.selectedGameId);
  if (!game) {
    return contextShell({
      kicker: "游戏库",
      title: "游戏库",
      subtitle: "字段快照。",
      body: contextEmpty("暂无游戏。"),
      variant: "context-library",
    });
  }
  const result = game.ai_en?.result ?? {};
  const fields = gameFieldPairs(game);
  const health = gameHealth(game);
  const body = `
    <section class="context-section">
      <div class="context-section-head"><span>游戏链接</span><b>${escapeHtml(game.game_id)}</b></div>
      <p class="context-url">${escapeHtml(game.url)}</p>
    </section>
    <div class="field-grid context-field-grid">${fields.map(([label, value]) => fieldItem(label, value || "-")).join("")}</div>
    <section class="context-section">
      <div class="context-section-head"><span>英文介绍</span><b>英文文案</b></div>
      <p>${escapeHtml(result.product_overview_150_words || "-")}</p>
    </section>
  `;
  return contextShell({
    kicker: "游戏库",
    title: game.game_name || game.game_id,
    subtitle: "字段、分类、英文文案。",
    chips: [[health.reviewLabel, health.reviewTone], [game.evaluation_source || "AI 缺失", game.evaluation_source ? "good" : "bad"]],
    body,
    footer: contextFileActions(game),
    variant: "context-library",
  });
}

function renderReviewContext() {
  const game = selectedGame();
  if (!game) {
    return contextShell({
      kicker: "证据复核",
      title: "证据复核",
      subtitle: "截图、视频、质量提示。",
      body: contextEmpty("暂无游戏。"),
      variant: "context-review",
    });
  }
  return reviewContextMarkup(game, true);
}

function renderConfigContext() {
  const config = state.status?.config ?? {};
  const feishu = config.feishu ?? {};
  const ai = aiConfig(config);
  const activeAi = activeAiProvider(ai);
  const steps = setupStepsData();
  const done = steps.filter((step) => step.done).length;
  const taxonomyCount = Number(config.taxonomy?.option_count ?? 0);
  const fieldState = fieldComposerWriteReadiness();
  const fieldDiffStatus = fieldComposerStatusLabel(state.fieldComposerDiff?.status);
  const testReadiness = buildExperienceTestReadiness();
  const body = `
    <div class="context-metrics">
      ${contextMetric("进度", `${done}/${steps.length}`, done === steps.length ? "good" : "warn")}
      ${contextMetric("AI", activeAi?.api_key_configured ? aiProviderLabel(ai.active_provider) : "待填", activeAi?.api_key_configured ? "good" : "bad")}
      ${contextMetric("飞书", feishu.ready ? "已连接" : "待检", feishu.ready ? "good" : "warn")}
      ${contextMetric("截图", feishu.upload_screenshots ? "附件字段" : "本地路径", "")}
    </div>
    <section class="context-section">
      <div class="context-section-head"><span>AI 模型</span><b>${escapeHtml(activeAi?.model || aiProviderLabel(ai.active_provider))}</b></div>
      <div class="context-metrics">
        ${contextMetric("供应商", aiProviderLabel(ai.active_provider), "")}
        ${contextMetric("API Key", activeAi?.api_key_configured ? "已保存" : "待填", activeAi?.api_key_configured ? "good" : "bad")}
        ${contextMetric("链路", activeAi?.runtime_ready ? "已接入" : "待接入", activeAi?.runtime_ready ? "good" : "warn")}
        ${contextMetric("测试", activeAi?.latest_check_status === "ok" ? "通过" : "待测", activeAi?.latest_check_status === "ok" ? "good" : "warn")}
      </div>
    </section>
    <section class="context-section">
      <div class="context-section-head"><span>飞书连接</span><b>${escapeHtml(feishu.evaluation_table_id || "未指定表格")}</b></div>
      <div class="context-metrics">
        ${contextMetric("凭证", feishu.app_id_configured && feishu.app_secret_configured ? "已保存" : "待填", feishu.app_id_configured && feishu.app_secret_configured ? "good" : "bad")}
        ${contextMetric("目标表", feishu.app_token && feishu.evaluation_table_id ? "已填写" : "待填", feishu.app_token && feishu.evaluation_table_id ? "good" : "warn")}
        ${contextMetric("连接", feishu.ready ? "通过" : "待检", feishu.ready ? "good" : "warn")}
      </div>
    </section>
    <section class="context-section">
      <div class="context-section-head"><span>字段和标签库</span><b>${escapeHtml(fieldState.label)}</b></div>
      <div class="context-metrics">
        ${contextMetric("字段", fieldState.ok ? "匹配" : fieldDiffStatus, fieldState.ok ? "good" : "warn")}
        ${contextMetric("标签库", taxonomyCount ? `${taxonomyCount} 项` : "待同步", taxonomyCount ? "good" : "warn")}
        ${contextMetric("截图", feishu.upload_screenshots ? "飞书附件字段" : "本地路径", "")}
      </div>
    </section>
    ${experienceTestReadinessPanel(testReadiness)}
    <section class="context-section">
      <div class="context-section-head"><span>配置健康度</span><b>配置清单</b></div>
      <div class="context-list">${steps.map(contextSetupRow).join("")}</div>
    </section>
    <section class="context-section">
      <div class="context-section-head"><span>本地目录</span><b>证据目录</b></div>
      <p class="context-url">${escapeHtml(state.status?.data_root || "读取中")}</p>
    </section>
  `;
  return contextShell({
    kicker: "配置",
    title: "配置状态",
    subtitle: "只显示状态，不回显已保存的密钥和 Secret。",
    chips: [[done === steps.length ? "就绪" : "待配置", done === steps.length ? "good" : "warn"], [testReadiness.title, testReadiness.tone]],
    body,
    footer: `<button class="button" data-panel-job="quick-check" type="button">快速检查</button><button class="button primary" data-panel-jump="config" data-panel-view="config" type="button">去配置</button>`,
    variant: "context-config",
  });
}

function experienceTestReadinessPanel(readiness) {
  const visibleRows = readiness.rows.filter((item) => item.tone !== "good");
  const passSummary = readiness.passed
    ? experienceReadinessRow(readinessItem("good", `${readiness.passed} 项已通过`, "已通过项不展开，优先处理上面的阻塞和观察项。"))
    : "";
  return `<section class="context-section experience-readiness ${escapeAttr(readiness.tone)}">
    <div class="context-section-head">
      <span>v1.8.3 体验测试清单</span>
      <b>${escapeHtml(readiness.title)}</b>
    </div>
    <p>${escapeHtml(readiness.detail)}</p>
    <div class="context-metrics readiness-metrics">
      ${contextMetric("阻塞", readiness.blocking, readiness.blocking ? "bad" : "good")}
      ${contextMetric("待观察", readiness.warnings, readiness.warnings ? "warn" : "good")}
      ${contextMetric("通过", `${readiness.passed}/${readiness.total}`, readiness.blocking ? "warn" : "good")}
    </div>
    <div class="readiness-actions">
      <button class="button small" data-copy-experience-readiness type="button">复制测试摘要</button>
    </div>
    <div class="context-list">
      ${visibleRows.map(experienceReadinessRow).join("") || contextEmpty("没有阻塞和待观察项，可以开始体验测试。")}
      ${passSummary}
    </div>
  </section>`;
}

function experienceReadinessRow(item) {
  const label = item.tone === "bad" ? "阻塞" : item.tone === "warn" ? "观察" : "通过";
  const action = item.action ? contextActionMarkup(item.action) : pill(label, item.tone);
  return `<div class="context-row readiness-row ${escapeAttr(item.tone)}">
    <div><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.detail)}</span></div>
    ${action}
  </div>`;
}

function renderGuideContext() {
  const steps = [
    ["创建应用", "企业自建应用，名称建议 H5 游戏评测助手。"],
    ["复制凭证", "App ID 可明文保存，App Secret 只填入本工具。"],
    ["开通权限", "至少需要多维表格读写管理和 Wiki 节点读取。"],
    ["发布版本", "个人测试也需要发布，权限才会生效。"],
    ["添加文档应用", "在多维表格右上角文档应用中加入本应用。"],
    ["检查连接", "回到配置中心检查飞书凭证和目标表格是否可访问。"],
  ];
  const body = `
    <section class="context-section guide-mini">
      <div class="context-section-head"><span>接入路径</span><b>6 步</b></div>
      <div class="context-list">${steps.map(([title, detail], index) => contextGuideRow(title, detail, index)).join("")}</div>
    </section>
    <section class="context-section">
      <div class="context-section-head"><span>关键提醒</span><b>个人飞书也适用</b></div>
      <p>发布、权限、文档应用缺一不可；Secret 不回显。</p>
    </section>
  `;
  return contextShell({
    kicker: "飞书",
    title: "接入向导",
    subtitle: "接入步骤和入口。",
    chips: [["内置", "good"]],
    body,
    footer: `<a class="button" href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">开发者后台</a><button class="button" data-panel-jump="guide" data-panel-view="guide" type="button">查看图文向导</button><button class="button primary" data-panel-jump="config" data-panel-view="config" type="button">去配置</button>`,
    variant: "context-guide",
  });
}

function reviewContextMarkup(game, full = false) {
  const result = game.ai_en?.result ?? {};
  const signals = qualitySignals(game);
  const review = game.review ?? { status: "pending", notes: "" };
  const reviewMeta = [
    review.updated_at ? `上次保存 ${formatDateTime(review.updated_at)}` : "尚未保存",
    reviewSyncText(review.feishu_sync),
  ].filter(Boolean).join(" · ");
  const screenshotCount = game.screenshots?.length ?? 0;
  const videoCount = game.videos?.length ?? 0;
  const flagCount = signals.length;
  const shotStrip = shotStripMarkup(game, { limit: full ? 6 : 4, full });

  const body = `
    ${qualityPanel(signals)}
    ${screenshotUploadPanel(game)}
    ${taxonomyPreflightPanel(game)}
    ${shotStrip}
    <div class="evidence-line">
      <span>本地视频</span>
      ${(game.videos ?? []).length
        ? game.videos.map((item) => `<a href="${escapeAttr(item.href)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>`).join("")
        : `<span>${escapeHtml(game.video_status === "disabled" ? "当前档位不录视频" : "暂无视频")}</span>`}
    </div>
    ${autoplayReviewCard(game)}
    ${autoplayLogPreview(game, full ? 10 : 5)}
    <div class="field-section">
      <div class="field-section-head">AI 字段快照</div>
      <div class="field-grid">${gameFieldPairs(game).map(([label, value]) => fieldItem(label, value || "-")).join("")}</div>
    </div>
    ${reviewBoxMarkup(review, signals, reviewMeta)}
    <div class="copy-block">
      <h3>英文简介</h3>
      <p>${escapeHtml(result.product_overview_150_words || "-")}</p>
      <h3>玩法说明</h3>
      ${list(result.how_to_play)}
    </div>
  `;
  return contextShell({
    kicker: "选中游戏",
    title: game.game_name || game.game_id,
    subtitle: game.url,
    chips: [[`${screenshotCount} 张截图`, ""], [`${videoCount} 段视频`, ""], [`${flagCount} 个提示`, flagCount ? "warn" : "good"]],
    body,
    footer: contextFileActions(game),
    variant: full ? "context-review is-full" : "context-review",
  });
}

function selectedGamePreview(game, options = {}) {
  const signals = qualitySignals(game);
  const shotLimit = options.shotLimit ?? 2;
  return `<section class="context-section selected-preview">
    <div class="context-section-head"><span>选中游戏</span><b>${escapeHtml(game.game_name || game.game_id)}</b></div>
    ${qualityPanel(signals)}
    ${selectedWriteReadiness(game)}
    ${autoplayReviewCard(game, { compact: true })}
    ${autoplayLogPreview(game, 4)}
    ${shotStripMarkup(game, { limit: shotLimit, compact: true })}
    ${options.includeActions ? `<div class="context-actions compact-actions">
      <button class="button" data-rerun="collect" type="button">重跑采集</button>
      <button class="button" data-rerun="ai" type="button">重跑 AI</button>
    </div>` : ""}
  </section>`;
}

function selectedWriteReadiness(game) {
  const preflight = game.taxonomy_preflight;
  const upload = game.screenshot_upload;
  if (!preflight && !upload) return "";
  const preflightMissing = preflight?.summary?.missing_option_count ?? preflight?.missing_options?.length ?? 0;
  const preflightLabel = preflight
    ? preflightMissing
      ? `${preflightMissing} 缺失`
      : displayValue(preflight.status)
    : "-";
  const preflightTone = preflight
    ? preflightMissing || preflight.status === "taxonomy_not_synced" ? "warn" : "good"
    : "";
  const uploadInfo = upload ? screenshotUploadInfo(upload) : null;
  return `<div class="context-metrics selected-write-metrics">
    ${preflight ? contextMetric("标签预检", preflightLabel, preflightTone) : ""}
    ${upload ? contextMetric("截图写入", uploadInfo.title, uploadInfo.tone) : ""}
  </div>`;
}

function shotStripMarkup(game, { limit = 4, full = false, compact = false } = {}) {
  const items = (game.screenshots ?? []).slice(0, limit);
  const rows = Math.max(1, Math.ceil(Math.max(items.length, 1) / 2));
  const cardHeight = full ? 170 : compact ? 118 : 132;
  const minHeight = items.length ? rows * cardHeight + Math.max(0, rows - 1) * 10 : 0;
  const classes = ["shot-strip", full ? "large" : "", compact ? "compact" : ""].filter(Boolean).join(" ");
  const style = minHeight ? ` style="min-height:${minHeight}px"` : "";
  return `<div class="${escapeAttr(classes)}"${style}>${items.map(shot).join("") || `<div class="empty-state compact">暂无截图</div>`}</div>`;
}

function autoplayLine(game) {
  const autoplay = game.autoplay ?? {};
  const actionCount = game.collection_quality?.autoplay_action_count ?? (autoplay.runs ?? []).reduce((sum, item) => sum + Number(item.action_count ?? 0), 0);
  if (!autoplay.strategy && !actionCount) return "";
  return `<div class="evidence-line">
    <span>自动试玩</span>
    <span>${escapeHtml(playStrategyLabel(autoplay.strategy || game.collection_quality?.play_strategy || "-"))} · ${escapeHtml(actionCount)} 次动作</span>
  </div>`;
}

function autoplayReviewCard(game, options = {}) {
  const review = autoplayQualityReview(game);
  const compact = Boolean(options.compact);
  return `<section class="autoplay-review-card context-section ${escapeAttr(review.tone)} ${compact ? "compact" : ""}">
    <div class="context-section-head">
      <span>自动试玩复盘</span>
      <b>${escapeHtml(review.title)}</b>
    </div>
    <p>${escapeHtml(review.detail)}</p>
    <div class="context-metrics">
      ${contextMetric("策略", review.strategyLabel, "")}
      ${contextMetric("动作", String(review.actionCount), review.actionCount ? "good" : "warn")}
      ${contextMetric("档位", String(review.runCount), review.runCount ? "good" : "warn")}
      ${contextMetric("类型", review.actionTypeText, review.actionTypeTone)}
    </div>
    <div class="autoplay-recommendation">
      <span>建议</span>
      <b>${escapeHtml(review.recommendation)}</b>
    </div>
  </section>`;
}

function autoplayQualityReview(game) {
  const autoplay = game.autoplay ?? {};
  const collectionQuality = game.collection_quality ?? {};
  const actions = autoplayActions(game);
  const actionCount = autoplayActionCount(game);
  const actionTypes = [...new Set(actions.map((action) => action.type).filter(Boolean))];
  const runCount = Array.isArray(autoplay.runs) ? autoplay.runs.length : 0;
  const strategy = autoplay.strategy || collectionQuality.play_strategy || "-";
  const strategyLabel = playStrategyLabel(strategy);
  const expectedScreenshots = Math.min(4, collectionQuality.expected_runs ?? 4);
  const screenshotCount = game.screenshots?.length ?? 0;
  const hasFailedRun = (collectionQuality.failed_runs ?? []).length > 0;
  const hasTargetMismatch = (collectionQuality.target_mismatched_runs ?? []).length > 0;
  const screenshotShort = screenshotCount < expectedScreenshots;
  const oneNoteActions = actionCount > 0 && actionTypes.length <= 1;

  if (!strategy || strategy === "-") {
    return {
      tone: "warn",
      title: "暂无自动试玩记录",
      detail: "没有读取到自动试玩策略或动作日志，只能依赖截图和人工复核判断。",
      recommendation: "用 ai_probe_alpha 或 poc_review 重跑采集，先生成动作轨迹。",
      strategyLabel: "-",
      actionCount,
      runCount,
      actionTypeText: "-",
      actionTypeTone: "warn",
    };
  }

  if (hasFailedRun) {
    return {
      tone: "bad",
      title: "采集档位失败",
      detail: "部分设备或网络档位没有完成采集，自动试玩结论不稳定。",
      recommendation: "优先重跑采集；若同一游戏仍失败，标为需人工确认。",
      strategyLabel,
      actionCount,
      runCount,
      actionTypeText: actionTypes.length ? `${actionTypes.length} 类` : "-",
      actionTypeTone: actionTypes.length ? "" : "warn",
    };
  }

  if (!actionCount) {
    return {
      tone: "warn",
      title: "没有记录有效动作",
      detail: `${strategyLabel} 未留下点击、拖拽或按键日志，可能停在首屏、广告或加载页。`,
      recommendation: strategy === "passive" ? "改用引导探测或 AI 预留探测后重跑采集。" : "重跑采集，并复核截图是否被弹窗或广告遮挡。",
      strategyLabel,
      actionCount,
      runCount,
      actionTypeText: "-",
      actionTypeTone: "warn",
    };
  }

  if (hasTargetMismatch || screenshotShort || oneNoteActions) {
    const detail = [
      hasTargetMismatch ? "有设备档位疑似跳到其他页面" : "",
      screenshotShort ? `截图 ${screenshotCount}/${expectedScreenshots}` : "",
      oneNoteActions ? "动作类型偏单一" : "",
    ].filter(Boolean).join("，");
    return {
      tone: "warn",
      title: "轨迹可用但需复核",
      detail: `${strategyLabel} 记录了 ${actionCount} 次动作，${detail || "仍建议人工确认核心玩法截图" }。`,
      recommendation: "先看截图和动作日志；如果没有进入玩法，再用 AI 预留探测重跑。",
      strategyLabel,
      actionCount,
      runCount,
      actionTypeText: `${actionTypes.length} 类`,
      actionTypeTone: oneNoteActions ? "warn" : "",
    };
  }

  return {
    tone: "good",
    title: "轨迹可用",
    detail: `${strategyLabel} 记录了 ${actionCount} 次动作，覆盖 ${actionTypes.length} 类操作，可作为 AI 字段生成依据。`,
    recommendation: "进入人工复核，确认截图、视频和字段后即可写入飞书。",
    strategyLabel,
    actionCount,
    runCount,
    actionTypeText: `${actionTypes.length} 类`,
    actionTypeTone: "good",
  };
}

function autoplayLogPreview(game, limit = 5) {
  const rows = autoplayActions(game).slice(0, limit);
  if (!rows.length) return "";
  return `<section class="autoplay-log context-section">
    <div class="context-section-head"><span>动作日志</span><b>${escapeHtml(`${rows.length} / ${autoplayActionCount(game)} 条`)}</b></div>
    <div class="autoplay-action-list">
      ${rows.map(autoplayActionRow).join("")}
    </div>
  </section>`;
}

function autoplayActions(game) {
  const runs = game.autoplay?.runs ?? [];
  return runs.flatMap((run) => (run.sampled_actions ?? []).map((action) => ({
    ...action,
    run_id: run.id,
    run_label: run.label,
    strategy: run.strategy,
  })));
}

function autoplayActionCount(game) {
  return game.collection_quality?.autoplay_action_count ?? (game.autoplay?.runs ?? []).reduce((sum, run) => sum + Number(run.action_count ?? 0), 0);
}

function autoplayActionRow(action) {
  const title = action.type === "keypress"
    ? `${action.type} ${action.key ?? ""}`.trim()
    : action.type === "drag"
      ? "drag"
      : "click";
  const detail = action.type === "drag"
    ? `${pointText(action.from)} -> ${pointText(action.to)}`
    : action.type === "keypress"
      ? action.key || "-"
      : `${action.target || "-"} ${pointText(action)}`.trim();
  return `<div class="autoplay-action-row">
    <b>${escapeHtml(title)}</b>
    <span>${escapeHtml(action.run_id || "-")} · ${escapeHtml(detail)}</span>
  </div>`;
}

function pointText(point) {
  if (!point || typeof point !== "object") return "";
  if (point.x == null || point.y == null) return "";
  return `(${Math.round(point.x)}, ${Math.round(point.y)})`;
}

function reviewBoxMarkup(review, signals, reviewMeta) {
  return `<div class="review-box">
    <div>
      <h3>人工复核</h3>
      <p>本地保存复核状态和备注，并在配置完整时同步到飞书。</p>
    </div>
    <div class="review-seg">
      <button type="button" data-review-status="pending" class="${review.status === "pending" ? "active" : ""}">待复核</button>
      <button type="button" data-review-status="approved" class="${review.status === "approved" ? "active" : ""}">通过</button>
      <button type="button" data-review-status="needs_changes" class="${review.status === "needs_changes" ? "active" : ""}">需修改</button>
    </div>
    <label>
      <span>复核状态</span>
      <select id="reviewStatus">
        <option value="pending" ${review.status === "pending" ? "selected" : ""}>待复核</option>
        <option value="approved" ${review.status === "approved" ? "selected" : ""}>已通过</option>
        <option value="needs_changes" ${review.status === "needs_changes" ? "selected" : ""}>需修改</option>
      </select>
    </label>
    <label>
      <span>备注</span>
      <textarea id="reviewNotes" rows="3" placeholder="记录需要人工确认的点">${escapeHtml(review.notes || "")}</textarea>
    </label>
    <div class="review-actions">
      <button class="button" id="fillReviewNotesButton" type="button" ${signals.length ? "" : "disabled"}>填入质量提示</button>
      <button class="button" id="saveReviewButton" type="button">保存复核</button>
      <span>${escapeHtml(reviewMeta)}</span>
    </div>
  </div>`;
}

function taxonomyPreflightPanel(game) {
  const preflight = game.taxonomy_preflight;
  if (!preflight) return "";
  const missing = preflight.missing_options ?? [];
  const synced = Number(preflight.option_count ?? 0) > 0;
  const tone = missing.length || !synced ? "warn" : "good";
  const rows = taxonomyPreflightRows(preflight);
  const checkedFields = preflight.checked_fields ?? [];
  const checkedFieldCount = preflight.summary?.checked_field_count ?? checkedFields.length;
  const matchedOptionCount = preflight.summary?.matched_option_count ?? checkedFields.reduce((sum, field) => sum + Math.max(0, (field.values?.length ?? 0) - (field.missing_options?.length ?? 0)), 0);
  const missingOptionCount = preflight.summary?.missing_option_count ?? missing.length;
  return `<div class="field-section taxonomy-preflight ${escapeAttr(tone)}">
    <div class="field-section-head">飞书标签库预检 · ${escapeHtml(displayValue(preflight.status || game.feishu_preview_status))}</div>
    <div class="context-metrics">
      ${contextMetric("字段", String(checkedFieldCount), "")}
      ${contextMetric("已匹配", String(matchedOptionCount), synced && !missing.length ? "good" : "")}
      ${contextMetric("缺失", String(missingOptionCount), missing.length ? "warn" : "good")}
    </div>
    <div class="field-grid">${rows || fieldItem("状态", synced ? "暂无可检查字段" : "请先同步飞书标签库")}</div>
  </div>`;
}

function taxonomyPreflightRows(preflight) {
  const missing = preflight.missing_options ?? [];
  if (missing.length) {
    return missing.slice(0, 6).map((item) => {
      const category = item.category_label_zh || taxonomyCategoryLabel(item.category);
      return fieldItem(item.field_label_zh || item.field_name, `${item.option} · ${category}待确认`);
    }).join("");
  }
  const categories = preflight.summary?.by_category ?? [];
  if (categories.length) {
    return categories.slice(0, 6).map((item) => {
      const label = item.label_zh || taxonomyCategoryLabel(item.category);
      const detail = item.status === "taxonomy_not_synced"
        ? "待同步标签库"
        : `${item.matched_options ?? 0}/${item.checked_values ?? 0} 项已匹配`;
      return fieldItem(label, detail);
    }).join("");
  }
  return (preflight.checked_fields ?? []).slice(0, 6).map((item) => {
    const label = item.field_label_zh || item.field_name;
    return fieldItem(label, `${item.values?.length ?? 0} 项已匹配`);
  }).join("");
}

function screenshotUploadPanel(game) {
  const upload = game.screenshot_upload;
  if (!upload) return "";
  const info = screenshotUploadInfo(upload);
  return `<div class="field-section screenshot-upload ${escapeAttr(info.tone)}">
    <div class="field-section-head">截图写入 · ${escapeHtml(info.title)}</div>
    <p>${escapeHtml(info.detail)}</p>
    <div class="context-metrics">
      ${contextMetric("附件", String(upload.attachment_count ?? 0), upload.can_view_in_feishu ? "good" : "")}
      ${contextMetric("上传", String(upload.uploaded_count ?? 0), "")}
      ${contextMetric("复用", String(upload.reused_count ?? 0), "")}
      ${contextMetric("失败", String(upload.failed_count ?? 0), Number(upload.failed_count ?? 0) ? "bad" : "good")}
    </div>
  </div>`;
}

function screenshotUploadInfo(upload) {
  const status = upload.status || (upload.enabled ? "not_written" : "disabled");
  if (!upload.enabled || status === "disabled") {
    return {
      title: "本地路径",
      detail: `当前不会上传飞书附件；写入时只保留 ${upload.fallback_field_name || "Screenshots"} 本地路径。`,
      tone: "",
    };
  }
  if (status === "skipped_dry_run") {
    return {
      title: "预演跳过",
      detail: "预演不会上传附件，正式写入并通过标签预检后才会上传到飞书附件字段。",
      tone: "warn",
    };
  }
  if (status === "blocked_taxonomy_review") {
    return {
      title: "标签待复核",
      detail: "标签选项缺失或待同步，工具暂不上传截图附件，避免写入半成品记录。",
      tone: "warn",
    };
  }
  if (status === "ready") {
    return {
      title: upload.can_view_in_feishu ? "飞书可直接查看" : "待写入附件字段",
      detail: `已准备 ${upload.attachment_count ?? 0} 个附件令牌，写入 ${upload.field_name || "Screenshot Attachments"} 后可在飞书表格查看。`,
      tone: "good",
    };
  }
  if (status === "partial_failed") {
    return {
      title: "部分失败",
      detail: "部分截图没有上传成功；成功的附件仍会写入，失败项保留本地路径用于复核。",
      tone: "bad",
    };
  }
  return {
    title: "待正式写入验证",
    detail: `当前配置会上传到 ${upload.field_name || "Screenshot Attachments"}，但还没有正式写入结果。`,
    tone: "warn",
  };
}

function gameFieldPairs(game) {
  const result = game.ai_en?.result ?? {};
  return [
    ["类型", result.game_type],
    ["细分", result.subgenre],
    ["题材", joinValue(result.theme)],
    ["画风", joinValue(result.art_style)],
    ["人群", joinValue(result.target_audience)],
    ["操作", joinValue(result.controls)],
    ["方向", result.orientation],
    ["BGM", result.bgm],
  ];
}

function contextMetric(label, value, tone = "") {
  return `<div class="context-metric ${escapeAttr(tone)}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function contextTaskRow(task) {
  const status = task.status ?? "-";
  const elapsed = task.elapsed_ms ? formatElapsed(task.elapsed_ms) : "";
  const meta = [elapsed, task.exit_code !== null && task.exit_code !== undefined ? `exit ${task.exit_code}` : ""].filter(Boolean).join(" · ");
  return `<div class="context-row ${escapeAttr(statusTone(status))}">
    <div><b>${escapeHtml(task.game_id ?? "-")}</b><span>${escapeHtml(meta || `#${task.index ?? "-"}/${task.total ?? "-"}`)}</span></div>
    ${taskPill(status, statusTone(status))}
  </div>`;
}

function contextTaskDetailRow(task) {
  const status = task.status ?? "-";
  const attempts = task.attempts ?? [];
  const latestAttempt = attempts[attempts.length - 1] ?? null;
  const elapsed = task.elapsed_ms ? formatElapsed(task.elapsed_ms) : "";
  const meta = [
    elapsed,
    task.exit_code !== null && task.exit_code !== undefined ? `exit ${task.exit_code}` : "",
    attempts.length ? `${attempts.length} 次尝试` : "",
  ].filter(Boolean).join(" · ");
  const error = task.status === "failed" ? summarizeTaskError(task) : "";
  const links = latestAttempt ? [
    latestAttempt.stdout_log ? fileActionLink("stdout", dataFileHref(latestAttempt.stdout_log), true, "") : "",
    latestAttempt.stderr_log ? fileActionLink("stderr", dataFileHref(latestAttempt.stderr_log), true, "") : "",
  ].filter(Boolean).join("") : "";
  return `<div class="context-row batch-task-detail ${escapeAttr(statusTone(status))}">
    <div>
      <b>${escapeHtml(task.game_id ?? "-")}</b>
      <span>${escapeHtml(meta || `#${task.index ?? "-"}/${task.total ?? "-"}`)}</span>
      ${error ? `<p>${escapeHtml(error)}</p>` : ""}
    </div>
    <div class="context-row-actions">
      ${taskPill(status, statusTone(status))}
      ${links ? `<div class="context-log-links">${links}</div>` : ""}
    </div>
  </div>`;
}

function contextBatchRunRow(run, index) {
  const totals = run.totals ?? {};
  const tone = statusTone(run.status);
  const meta = [
    run.profile_name || "-",
    formatDateTime(run.started_at),
    run.duration_ms ? formatElapsed(run.duration_ms) : "",
  ].filter(Boolean).join(" · ");
  return `<div class="context-row ${escapeAttr(tone)} ${state.selectedBatchHistoryIndex === index ? "active" : ""}">
    <div><b>${escapeHtml(`${batchModeLabel(run.mode)} · ${displayValue(run.status || "-")}`)}</b><span>${escapeHtml(meta)}</span></div>
    <button class="button small" data-context-batch-detail="${index}" type="button">${escapeHtml(`${totals.success ?? 0}/${totals.queued ?? run.tasks?.length ?? 0}`)}</button>
  </div>`;
}

function contextSetupRow(step, index) {
  const action = step.done ? "" : contextActionMarkup(step.action);
  return `<div class="context-row ${step.done ? "good" : "warn"}">
    <div><b>${escapeHtml(`${index + 1}. ${step.title}`)}</b><span>${escapeHtml(step.detail)}</span></div>
    ${step.done ? pill("完成", "good") : action}
  </div>`;
}

function contextGuideRow(title, detail, index) {
  return `<div class="context-row">
    <i>${String(index + 1).padStart(2, "0")}</i>
    <div><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div>
  </div>`;
}

function contextActionMarkup(action) {
  if (!action) return "";
  const attrs = [
    action.job ? `data-panel-job="${escapeAttr(action.job)}"` : "",
    action.scroll ? `data-panel-jump="${escapeAttr(action.scroll)}"` : "",
    action.view ? `data-panel-view="${escapeAttr(action.view)}"` : "",
    action.mode ? `data-panel-mode="${escapeAttr(action.mode)}"` : "",
    action.fieldDiff ? "data-panel-field-diff=\"true\"" : "",
  ].filter(Boolean).join(" ");
  if (attrs) return `<button class="button small" ${attrs} type="button">${escapeHtml(action.label)}</button>`;
  return "";
}

function contextFileActions(game) {
  return `${fileActionLink("报告", game.report_href, game.report_exists, "未生成报告")}
    ${fileActionLink("写入预览", game.payload_href, game.payload_exists, "未生成写入预览")}
    <button class="button" data-export-evidence type="button">导出证据包</button>
    <button class="button" data-rerun="collect" type="button">重跑采集</button>
    <button class="button" data-rerun="ai" type="button">重跑 AI</button>
    <button class="button primary" data-rerun="feishu" type="button">重写飞书</button>`;
}

function fileActionLink(label, href, exists, missingLabel) {
  if (!exists) {
    return `<span class="status-token disabled" aria-disabled="true" title="${escapeAttr(missingLabel)}">${escapeHtml(missingLabel)}</span>`;
  }
  return `<a class="button" href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function dataFileHref(relativePath) {
  const clean = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!clean) return "";
  return `/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

function contextEmpty(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function latestJobOutput() {
  const active = state.jobs.find((job) => job.id === state.activeJobId) ?? state.jobs[0];
  return [state.consoleText, active?.output].filter(Boolean).join("\n\n") || "等待任务输出...";
}

function bindContextPanelActions() {
  const game = selectedGame();
  const signals = game ? qualitySignals(game) : [];
  bindProductionRecoveryActions(elements.detailPanel);
  $("#saveReviewButton")?.addEventListener("click", () => saveReview(game.game_id));
  $("#fillReviewNotesButton")?.addEventListener("click", () => fillReviewNotes(signals));
  $$("[data-review-status]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#reviewStatus").value = button.dataset.reviewStatus;
      $$("[data-review-status]").forEach((item) => item.classList.toggle("active", item === button));
    });
  });
  $$("[data-rerun]").forEach((button) => {
    button.addEventListener("click", () => rerunSelectedGame(button.dataset.rerun));
  });
  $$("[data-panel-jump]").forEach((button) => {
    button.addEventListener("click", () => activateSection(button.dataset.panelJump, button.dataset.panelView, button.dataset.panelMode));
  });
  $$("[data-panel-job]").forEach((button) => {
    button.addEventListener("click", () => startJob(button.dataset.panelJob));
  });
  $$("[data-context-batch-detail]").forEach((button) => {
    button.addEventListener("click", () => selectBatchHistory(button.dataset.contextBatchDetail));
  });
  $$("[data-context-export-batch-report]").forEach((button) => {
    button.addEventListener("click", () => exportBatchReport(selectedBatchForDetail() ?? latestBatchRecord(state.status?.batch)));
  });
  elements.detailPanel?.querySelectorAll("[data-copy-autoplay-preflight]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      await copyTextButton(event.currentTarget, buildAutoplayPreflight().copyText, "复制预检摘要");
    });
  });
  elements.detailPanel?.querySelectorAll("[data-copy-experience-readiness]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      await copyTextButton(event.currentTarget, buildExperienceTestReadiness().copyText, "复制测试摘要");
    });
  });
  $("[data-export-evidence]")?.addEventListener("click", () => exportEvidencePackage(game?.game_id));
  $("[data-panel-field-diff]")?.addEventListener("click", checkFieldComposerDiff);
  $$("[data-shot-preview]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openShotPreview(link);
    });
  });
  $("#panelRunSelectedButton")?.addEventListener("click", runSelectedGame);
}

function fillReviewNotes(signals) {
  const textarea = $("#reviewNotes");
  if (!textarea) return;
  const next = qualityNotesText(signals);
  if (!next) return;
  const current = textarea.value.trim();
  textarea.value = current ? `${current}\n${next}` : next;
  textarea.focus();
}

async function saveReview(gameId) {
  const payload = {
    gameId,
    status: $("#reviewStatus").value,
    notes: $("#reviewNotes").value,
  };
  const result = await fetchJson("/api/review", { method: "POST", body: JSON.stringify(payload) });
  appendConsole(`复核已保存：${gameId}；飞书同步：${reviewSyncText(result.review?.feishu_sync) || "未执行"}`);
  await refreshStatus();
}

async function exportEvidencePackage(gameId) {
  if (!gameId) return;
  const result = await fetchJson("/api/evidence-package", {
    method: "POST",
    body: JSON.stringify({ gameId }),
  });
  const sizeMb = result.size_bytes ? `${(result.size_bytes / 1024 / 1024).toFixed(2)} MB` : "未知大小";
  appendConsole(`证据包已生成：${result.file_name}（${sizeMb}）`);
  if (result.href) window.open(result.href, "_blank", "noopener,noreferrer");
}

function openShotPreview(link) {
  const modal = $("#shotLightbox");
  const image = $("#shotLightboxImage");
  const title = $("#shotLightboxTitle");
  const open = $("#shotLightboxOpen");
  if (!modal || !image || !title || !open) return;
  const href = link.getAttribute("href") || "";
  const name = link.dataset.shotName || link.textContent?.trim() || "截图预览";
  image.src = href;
  image.alt = name;
  title.textContent = name;
  open.href = href;
  modal.hidden = false;
  document.body.classList.add("lightbox-open");
  $("#shotLightboxClose")?.focus();
}

function closeShotPreview() {
  const modal = $("#shotLightbox");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("lightbox-open");
  $("#shotLightboxImage")?.removeAttribute("src");
}

function renderJobs() {
  const running = state.jobs.filter((job) => ["running", "cancelling"].includes(job.status));
  const latest = state.jobs[0];
  elements.jobSummary.textContent = running.length
    ? `${running.length} 个任务运行中`
    : latest
      ? `${latest.name}: ${latest.status}`
      : "暂无任务";
  elements.navJobState.textContent = "02";
  const active = state.jobs.find((job) => job.id === state.activeJobId) ?? latest;
  const text = [state.consoleText, active?.output].filter(Boolean).join("\n\n");
  const fallback = "等待任务输出...";
  elements.jobOutput.textContent = text || fallback;
  $("#toggleConsoleButton").textContent = state.consoleExpanded ? "收起日志" : "展开日志";
  const cancellable = Boolean(active && ["running", "cancelling"].includes(active.status));
  elements.cancelJobButton.hidden = !cancellable;
  elements.cancelJobButton.disabled = active?.status === "cancelling";
  elements.cancelJobButton.textContent = active?.status === "cancelling" ? "取消中" : "取消任务";
  $(".shell").classList.toggle("console-expanded", state.consoleExpanded);
  if (contextMode() === "queue") renderContextPanel();
}

async function cancelActiveJob() {
  const active = state.jobs.find((job) => job.id === state.activeJobId && ["running", "cancelling"].includes(job.status))
    ?? state.jobs.find((job) => ["running", "cancelling"].includes(job.status));
  if (!active || active.status === "cancelling") return;
  await fetchJson(`/api/jobs/${encodeURIComponent(active.id)}/cancel`, { method: "POST" });
  appendConsole(`已请求取消任务：${active.name}`);
  await refreshJobs();
}

function toggleConsole() {
  state.consoleExpanded = !state.consoleExpanded;
  renderJobs();
}

async function saveConfig() {
  const aiForm = elements.aiForm;
  const payload = {
    ai: {
      activeProvider: aiForm.activeProvider.value,
      providers: {
        gemini: {
          apiKey: aiForm.geminiApiKey.value.trim(),
          model: aiForm.geminiModel.value,
          proxy: aiForm.geminiProxy.value.trim(),
        },
        openai_compatible: {
          apiKey: aiForm.openaiApiKey.value.trim(),
          baseUrl: aiForm.openaiBaseUrl.value.trim(),
          model: aiForm.openaiModel.value.trim(),
        },
        deepseek: {
          apiKey: aiForm.deepseekApiKey.value.trim(),
          baseUrl: aiForm.deepseekBaseUrl.value.trim(),
          model: aiForm.deepseekModel.value.trim(),
        },
        openrouter: {
          apiKey: aiForm.openrouterApiKey.value.trim(),
          baseUrl: aiForm.openrouterBaseUrl.value.trim(),
          model: aiForm.openrouterModel.value.trim(),
        },
      },
    },
    feishu: {
      appId: elements.feishuForm.appId.value.trim(),
      appSecret: elements.feishuForm.appSecret.value.trim(),
      bitableUrl: elements.feishuForm.bitableUrl.value.trim(),
      appToken: elements.feishuForm.appToken.value.trim(),
      tableId: elements.feishuForm.tableId.value.trim(),
      uploadScreenshots: elements.feishuForm.uploadScreenshots.checked,
    },
  };
  await fetchJson("/api/config", { method: "POST", body: JSON.stringify(payload) });
  aiForm.geminiApiKey.value = "";
  aiForm.openaiApiKey.value = "";
  aiForm.deepseekApiKey.value = "";
  aiForm.openrouterApiKey.value = "";
  elements.feishuForm.appSecret.value = "";
  elements.feishuForm.bitableUrl.value = "";
  await refreshStatus();
  appendConsole("配置已保存。");
}

async function importUrls() {
  const text = $("#urlInput").value.trim();
  if (!text) return;
  const response = await fetchJson("/api/games/import", {
    method: "POST",
    body: JSON.stringify({ urls: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }),
  });
  $("#urlInput").value = "";
  await refreshStatus();
  appendConsole(`导入完成：新增 ${response.added}, 更新 ${response.updated}, 跳过 ${response.skipped}`);
}

async function runSelectedGame() {
  const gate = buildRunGate({ batch: false });
  if (!gate.canRun) {
    appendConsole(`暂不能运行：${gate.detail}`);
    renderRunGate();
    renderNextStep();
    return;
  }
  const profileName = $("#runProfile").value;
  const profile = state.status?.run_profiles?.profiles?.[profileName] ?? {};
  await startJob("run-game", {
    gameId: state.selectedGameId,
    playSeconds: Number($("#playSeconds").value || 60),
    aiMode: $("#aiMode").value,
    profileName,
    trace: profile.trace ?? "off",
    aiEvalMode: profile.ai_eval_mode ?? "low",
    maxImages: profile.max_images ?? 2,
    playStrategy: currentPlayStrategy(profile),
    recordVideo: Boolean(profile.record_video),
    videoSeconds: Number(profile.video_seconds ?? 0),
    failOnPartial: Boolean(profile.fail_on_partial),
    writeFeishu: $("#writeFeishu").checked,
    forceCollect: $("#forceCollect").checked,
    forceAi: $("#forceAi").checked,
  });
}

async function rerunSelectedGame(kind) {
  if (!state.selectedGameId) return;
  const profileName = $("#runProfile").value;
  const profile = state.status?.run_profiles?.profiles?.[profileName] ?? {};
  const options = {
    gameId: state.selectedGameId,
    playSeconds: Number($("#playSeconds").value || profile.play_seconds || 60),
    aiMode: $("#aiMode").value,
    profileName,
    trace: profile.trace ?? "off",
    aiEvalMode: profile.ai_eval_mode ?? "low",
    maxImages: profile.max_images ?? 2,
    playStrategy: currentPlayStrategy(profile),
    recordVideo: Boolean(profile.record_video),
    videoSeconds: Number(profile.video_seconds ?? 0),
    failOnPartial: Boolean(profile.fail_on_partial),
    writeFeishu: true,
    forceCollect: kind === "collect",
    forceAi: kind === "collect" || kind === "ai",
  };
  await startJob("run-game", options);
  const labels = { collect: "重跑采集", ai: "重跑 AI", feishu: "重写飞书" };
  appendConsole(`${labels[kind] ?? "重跑"} 已开始：${state.selectedGameId}`);
}

function fillBatchAll() {
  elements.batchGameIds.value = (state.status.games ?? []).map((game) => game.game_id).join("\n");
  renderBatchSummary();
}

function fillBatchSelected() {
  if (!state.selectedGameId) return;
  elements.batchGameIds.value = state.selectedGameId;
  renderBatchSummary();
  renderAutoplayPreflight();
  renderContextPanel();
}

function removeBatchSelected() {
  if (!state.selectedGameId) return;
  const ids = selectedBatchGameIds();
  if (!ids.length) {
    appendConsole("当前队列为空，不需要移除。");
    updateQueueControls();
    return;
  }
  const nextIds = ids.filter((gameId) => gameId !== state.selectedGameId);
  elements.batchGameIds.value = nextIds.join("\n");
  renderBatchSummary();
  renderAutoplayPreflight();
  renderContextPanel();
  appendConsole(nextIds.length === ids.length ? `队列里没有 ${state.selectedGameId}` : `已从队列移除：${state.selectedGameId}`);
}

function clearBatchQueue() {
  elements.batchGameIds.value = "";
  renderBatchSummary();
  renderAutoplayPreflight();
  renderContextPanel();
  appendConsole("已清空当前队列输入，不会删除任何证据、报告或飞书记录。");
}

function updateQueueControls() {
  const ids = selectedBatchGameIds();
  const hasQueue = ids.length > 0;
  const selectedInQueue = Boolean(state.selectedGameId && ids.includes(state.selectedGameId));
  if (elements.removeBatchSelectedButton) {
    elements.removeBatchSelectedButton.disabled = !selectedInQueue;
    elements.removeBatchSelectedButton.title = hasQueue
      ? selectedInQueue
        ? `从当前队列移除 ${state.selectedGameId}，不删除游戏库记录`
        : "当前选中的游戏不在队列里"
      : "当前队列为空，没有可移除项";
  }
  if (elements.clearBatchQueueButton) {
    elements.clearBatchQueueButton.disabled = !hasQueue;
    elements.clearBatchQueueButton.title = hasQueue
      ? "清空当前队列输入，不删除游戏、证据、报告或批次历史"
      : "当前队列为空，没有可清空项";
  }
}

function removeBatchGameId(gameId) {
  const ids = selectedBatchGameIds();
  const nextIds = ids.filter((item) => item !== gameId);
  elements.batchGameIds.value = nextIds.join("\n");
  renderBatchSummary();
  renderAutoplayPreflight();
  renderContextPanel();
  appendConsole(nextIds.length === ids.length ? `队列里没有 ${gameId}` : `已从队列移除：${gameId}`);
}

function fillBatchFailed(batch = latestBatchRecord(state.status?.batch)) {
  const failed = batchRetryGameIds(batch);
  if (!failed.length) {
    appendConsole("这个批次没有失败项。");
    return;
  }
  elements.batchGameIds.value = failed.join("\n");
  elements.batchGameIds.scrollIntoView({ block: "center" });
  renderBatchSummary();
}

function fillBatchResume(batch = latestBatchRecord(state.status?.batch)) {
  const pending = batchResumeGameIds(batch);
  if (!pending.length) {
    appendConsole("这个批次没有未完成项。");
    return;
  }
  elements.batchGameIds.value = pending.join("\n");
  elements.batchGameIds.scrollIntoView({ block: "center" });
  renderBatchSummary();
}

function fillProductionRecovery() {
  const recovery = batchProductionOverview()?.recovery_plan ?? {};
  const ids = recovery.game_ids ?? [];
  if (!ids.length) {
    appendConsole("当前没有需要恢复的队列。");
    return;
  }
  elements.batchGameIds.value = ids.join("\n");
  elements.batchGameIds.scrollIntoView({ block: "center" });
  renderBatchSummary();
  renderAutoplayPreflight();
  renderContextPanel();
  appendConsole(`已填入${recovery.scope === "resume" ? "未完成项" : "失败项"}：${ids.join(", ")}`);
}

function bindProductionRecoveryActions(root = document) {
  root?.querySelectorAll("[data-production-recovery]").forEach((button) => {
    button.addEventListener("click", fillProductionRecovery);
  });
}

function fillBatchHistoryFailed(index) {
  const batch = batchHistory()[Number(index)];
  fillBatchFailed(batch);
}

function fillBatchHistoryResume(index) {
  const batch = batchHistory()[Number(index)];
  fillBatchResume(batch);
}

function exportBatchHistoryReport(index) {
  const batch = batchHistory()[Number(index)];
  return exportBatchReport(batch);
}

async function exportBatchReport(batch) {
  if (!batch) {
    appendConsole("没有可导出的批次。");
    return;
  }
  const payload = batchReportPayload(batch);
  if (!payload) {
    appendConsole("这个批次缺少报告来源。");
    return;
  }
  const report = await fetchJson("/api/batch-report", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  appendConsole(`批次报告已生成：${report.report_path ?? report.report_href}`);
  if (report.report_href) window.open(report.report_href, "_blank", "noopener,noreferrer");
  await refreshStatus();
}

function batchReportPayload(batch) {
  if (batch.archive_dir) return { archiveDir: batch.archive_dir };
  if (batch === state.status?.batch?.last_run) return { source: "last_run" };
  if (batch === state.status?.batch?.dry_run) return { source: "dry_run" };
  return batch.id ? { archiveDir: `batch/runs/${batch.id}` } : null;
}

function batchRetryGameIds(batch) {
  const fromSummary = batch?.retry_game_ids ?? [];
  if (fromSummary.length) return [...new Set(fromSummary.filter(Boolean))];
  return [...new Set((batch?.tasks ?? [])
    .filter((task) => ["failed", "skipped_duplicate"].includes(task.status))
    .map((task) => task.game_id)
    .filter(Boolean))];
}

function batchResumeGameIds(batch) {
  const fromSummary = batch?.resume_game_ids ?? [];
  if (fromSummary.length) return [...new Set(fromSummary.filter(Boolean))];
  if (batch?.mode !== "execute") return [];
  return [...new Set((batch?.tasks ?? [])
    .filter((task) => task.game_id && !["success", "skipped_duplicate"].includes(task.status))
    .map((task) => task.game_id)
    .filter(Boolean))];
}

function selectedBatchGameIds() {
  return elements.batchGameIds.value
    .split(/[,\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function currentBatchEstimate() {
  const profileName = currentRunProfileName();
  const profile = currentRunProfile();
  const count = selectedBatchGameIds().length || (state.status?.games ?? []).length;
  return runEstimateForCount(count, profileName, profile);
}

function runEstimateForCount(count, profileName = currentRunProfileName(), profile = currentRunProfile()) {
  if (!count) return null;
  const deviceCount = Math.max(1, Array.isArray(profile.devices) ? profile.devices.length : 4);
  const playSeconds = Math.max(0, Number($("#playSeconds")?.value || profile.play_seconds || 0));
  const totalProfileSeconds = Number(profile.total_play_seconds ?? 0);
  const collectSeconds = Math.max(
    totalProfileSeconds,
    playSeconds * deviceCount,
  );
  const videoSeconds = profile.record_video ? Math.max(0, Number(profile.video_seconds ?? 0)) : 0;
  const aiSeconds = estimateAiSeconds(profile);
  const feishuSeconds = $("#writeFeishu")?.checked === false ? 0 : 25;
  const reportSeconds = 35;
  const perGame = {
    collectMs: collectSeconds * 1000,
    videoMs: videoSeconds * 1000,
    aiMs: aiSeconds * 1000,
    feishuMs: feishuSeconds * 1000,
    reportMs: reportSeconds * 1000,
  };
  const perGameMs = Object.values(perGame).reduce((sum, value) => sum + value, 0);
  const taskRetries = Math.max(0, Number(profile.task_retries ?? 0));
  return {
    count,
    profileName,
    deviceCount,
    taskRetries,
    ...Object.fromEntries(Object.entries(perGame).map(([key, value]) => [key, value * count])),
    totalMs: perGameMs * count,
    retryBufferMs: perGameMs * count * taskRetries,
  };
}

function buildAutoplayPreflight() {
  const profileName = currentRunProfileName();
  const profile = currentRunProfile();
  const strategy = currentPlayStrategy(profile);
  const strategyLabel = playStrategyLabel(strategy);
  const scope = autoplayPreflightScope();
  const estimate = runEstimateForCount(scope.count, profileName, profile);
  const config = state.status?.config ?? {};
  const ai = aiConfig(config);
  const activeAi = activeAiProvider(ai);
  const activeAiReady = aiRuntimeReady(activeAi);
  const feishuReady = Boolean(config.feishu?.ready);
  const aiMode = $("#aiMode")?.value || profileAiMode(profile);
  const wantsFeishu = $("#writeFeishu")?.checked !== false;
  const totalSeconds = Math.max(
    Number(profile.total_play_seconds ?? 0),
    Number($("#playSeconds")?.value || profile.play_seconds || 0) * Math.max(1, Array.isArray(profile.devices) ? profile.devices.length : 4),
  );
  const items = [];

  if (!scope.count) {
    items.push(preflightItem("bad", "没有可运行游戏", "先导入 H5 链接，或在队列里填入 game_id。"));
  }
  if (totalSeconds >= 1800 && scope.count > 1) {
    items.push(preflightItem("warn", "正式 30 分钟批量耗时较长", "建议先用 poc_review 或 ai_probe_alpha 跑单款，确认截图、视频和飞书写入都正常。"));
  }
  if (strategy === "adaptive_probe" && scope.count > 1) {
    items.push(preflightItem("warn", "Alpha 策略建议先小批量", "AI 预留探测会记录更多动作日志，适合验证后再扩大到全量。"));
  }
  if (strategy === "passive") {
    items.push(preflightItem("warn", "只观察不会主动进入玩法", "适合排查加载和广告遮挡，但可能停在 Start 页。"));
  }
  if (strategy === "legacy_center_tap") {
    items.push(preflightItem("info", "安全点击偏保守", "兼容性高，但遇到拖拽、教程和弹窗时可能采不到核心玩法。"));
  }
  if (aiMode === "live" && !activeAiReady) {
    const reason = activeAi?.api_key_configured && !activeAi?.runtime_ready
      ? `${aiProviderLabel(ai.active_provider)} 已保存，但评测链路暂未接入该供应商。`
      : `${aiProviderLabel(ai.active_provider)} 尚未配置 API Key。`;
    items.push(preflightItem("bad", "AI 模型尚未可用", `${reason} 当前生产评测建议先使用 Gemini，或把 AI 模式改成本地兜底。`));
  }
  if (wantsFeishu && !feishuReady) {
    items.push(preflightItem("warn", "飞书未完全就绪", "本地证据仍会生成，但写入多维表格可能失败。"));
  }
  if (!wantsFeishu) {
    items.push(preflightItem("info", "本次不写入飞书", "截图、视频和 JSON 报告会留在本地证据目录。"));
  }
  if ($("#forceCollect")?.checked) {
    items.push(preflightItem("info", "会重新采集证据", "旧截图和视频不会作为本次判断依据。"));
  }
  if ($("#forceAi")?.checked) {
    items.push(preflightItem("info", "会重新生成 AI 评测", "会重新读取截图和字段库，覆盖本地 AI 结果。"));
  }
  if ($("#batchContinueOnError")?.checked === false && scope.count > 1) {
    items.push(preflightItem("warn", "失败后会停止队列", "适合严格验收；批量生产时通常建议打开失败后继续下一款。"));
  }

  const blocking = items.filter((item) => item.tone === "bad").length;
  const warnings = items.filter((item) => item.tone === "warn").length;
  const tone = blocking ? "bad" : warnings ? "warn" : "good";
  if (!items.length) {
    items.push(preflightItem("good", "可以运行", "当前设置没有明显阻断项，可以先预演队列或直接运行。"));
  }
  const title = tone === "bad" ? "需要先处理" : tone === "warn" ? "可运行但建议复核" : "可以运行";
  const chips = [
    scope.label,
    `${profileName || "自定义档位"}`,
    strategyLabel,
    estimate ? `约 ${formatDuration(estimate.totalMs)}` : "暂无耗时",
  ];
  const copyText = [
    "AI 自动试玩运行前预检",
    `状态：${title}`,
    `范围：${scope.label}`,
    `档位：${profileName || "自定义"}`,
    `策略：${strategyLabel} (${strategy})`,
    `预计基础耗时：${estimate ? formatDuration(estimate.totalMs) : "-"}`,
    `AI 模式：${aiMode === "live" ? aiProviderLabel(ai.active_provider) : "本地兜底"}`,
    `飞书写入：${wantsFeishu ? "开启" : "关闭"}`,
    ...items.map((item) => `- ${item.title}: ${item.detail}`),
  ].join("\n");

  return {
    tone,
    title,
    summary: `${scope.label} · ${strategyLabel} · ${estimate ? `预计 ${formatDuration(estimate.totalMs)}` : "暂无耗时估算"}`,
    chips,
    items,
    copyText,
  };
}

function autoplayPreflightScope() {
  const typedIds = selectedBatchGameIds();
  if (typedIds.length) {
    return { count: typedIds.length, label: `${typedIds.length} 款队列`, mode: "batch" };
  }
  const games = state.status?.games ?? [];
  if (contextMode() === "queue") {
    return { count: games.length, label: games.length ? `${games.length} 款全部样本` : "未导入游戏", mode: "batch_all" };
  }
  const game = selectedGame();
  if (game) {
    return { count: 1, label: game.game_name || game.game_id, mode: "single" };
  }
  return { count: games.length, label: games.length ? `${games.length} 款全部样本` : "未导入游戏", mode: "all" };
}

function preflightItem(tone, title, detail) {
  return { tone, title, detail };
}

function autoplayPreflightMarkup(preflight, options = {}) {
  const compact = Boolean(options.compact);
  const copyable = options.copyable !== false;
  const visibleItems = compact ? preflight.items.slice(0, 4) : preflight.items.slice(0, 6);
  return `<section class="autoplay-preflight-card ${escapeAttr(preflight.tone)} ${compact ? "compact" : ""}">
    <div class="preflight-head">
      <div>
        <span>运行前预检</span>
        <b>${escapeHtml(preflight.title)}</b>
        <p>${escapeHtml(preflight.summary)}</p>
      </div>
      ${copyable ? `<button class="button small" data-copy-autoplay-preflight type="button">复制摘要</button>` : ""}
    </div>
    <div class="preflight-chip-row">${preflight.chips.map((chip) => `<i>${escapeHtml(chip)}</i>`).join("")}</div>
    <div class="preflight-rule-list">
      ${visibleItems.map(preflightRuleMarkup).join("")}
      ${preflight.items.length > visibleItems.length ? `<div class="preflight-more">还有 ${preflight.items.length - visibleItems.length} 条提示，可在任务队列里查看完整预检。</div>` : ""}
    </div>
  </section>`;
}

function preflightRuleMarkup(item) {
  const symbol = item.tone === "bad" ? "!" : item.tone === "warn" ? "?" : "i";
  return `<div class="preflight-rule ${escapeAttr(item.tone)}">
    <i>${symbol}</i>
    <div><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.detail)}</span></div>
  </div>`;
}

function estimateAiSeconds(profile) {
  const mode = String(profile.ai_mode ?? "");
  if (!mode.includes("gemini")) return 8;
  const evalMode = String(profile.ai_eval_mode ?? "low");
  const imageCount = Math.max(1, Number(profile.max_images ?? 2));
  const base = evalMode === "standard" ? 75 : 40;
  return base + Math.max(0, imageCount - 2) * 8;
}

function batchEstimateMarkup(estimate) {
  const items = [
    ["采集", estimate.collectMs],
    ["视频", estimate.videoMs],
    ["AI", estimate.aiMs],
    ["飞书", estimate.feishuMs],
    ["报告", estimate.reportMs],
  ];
  return `<div class="batch-estimate-grid" aria-label="批量耗时估算">
    ${items.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(formatDuration(value))}</b></div>`).join("")}
    <div class="total"><span>基础总计</span><b>${escapeHtml(formatDuration(estimate.totalMs))}</b></div>
    ${estimate.retryBufferMs ? `<div class="warn"><span>重试上限</span><b>+${escapeHtml(formatDuration(estimate.retryBufferMs))}</b></div>` : ""}
  </div>`;
}

async function runBatch(execute) {
  const gate = execute ? buildRunGate({ batch: true }) : buildDryRunGate();
  if (!gate.canRun) {
    appendConsole(`暂不能${execute ? "运行" : "预演"}：${gate.detail}`);
    renderRunGate();
    renderNextStep();
    return;
  }
  const profileName = $("#runProfile").value;
  const profile = state.status?.run_profiles?.profiles?.[profileName] ?? {};
  const gameIds = selectedBatchGameIds();
  const resolvedIds = gameIds.length ? gameIds : (state.status.games ?? []).map((game) => game.game_id);
  const playSeconds = Number(profile.play_seconds ?? $("#playSeconds").value ?? 60);
  const totalSeconds = Number(profile.total_play_seconds ?? playSeconds);
  const failOnPartial = Boolean(profile.fail_on_partial) || totalSeconds >= 1800;
  if (execute && totalSeconds >= 1800 && resolvedIds.length > 1) {
    const estimate = currentBatchEstimate();
    const estimateText = estimate ? `预计基础耗时 ${formatDuration(estimate.totalMs)}。` : "预计耗时很长。";
    const ok = window.confirm(`将运行 ${resolvedIds.length} 款游戏的 30 分钟正式档，${estimateText}确定开始吗？`);
    if (!ok) return;
  }

  await startJob("run-batch", {
    execute,
    profileName,
    gameIds: resolvedIds,
    playSeconds,
    playStrategy: currentPlayStrategy(profile),
    writeFeishu: $("#writeFeishu").checked,
    forceCollect: $("#forceCollect").checked,
    forceAi: $("#forceAi").checked,
    continueOnError: $("#batchContinueOnError").checked,
    failOnPartial,
  });
}

async function startJob(action, options = {}) {
  const response = await fetchJson("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ action, options }),
  });
  state.activeJobId = response.job.id;
  appendConsole(`启动任务：${response.job.name}`);
  await refreshJobs();
}

async function openDataFolder() {
  await fetchJson("/api/open-data-folder", { method: "POST", body: "{}" });
  appendConsole(`已请求打开数据目录：${state.status?.data_root ?? ""}`);
}

function appendConsole(line) {
  state.consoleText = `${state.consoleText}${state.consoleText ? "\n" : ""}${line}`;
  renderJobs();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return text ? JSON.parse(text) : {};
}

function pill(value, tone = "") {
  return `<span class="pill ${tone}">${escapeHtml(displayValue(value))}</span>`;
}

function taskPill(value, tone = "") {
  return `<span class="pill ${tone}">${escapeHtml(displayTaskValue(value))}</span>`;
}

function displayTaskValue(value) {
  const labels = {
    pending: "待执行",
    planned: "已计划",
    running: "运行中",
    cancelling: "取消中",
    cancelled: "已取消",
    failed: "失败",
    success: "成功",
    skipped_duplicate: "重复跳过",
    skipped: "已跳过",
  };
  const key = String(value ?? "");
  return labels[key] ?? displayValue(value);
}

function displayValue(value) {
  if (value === "taxonomy_review_required") return "标签待复核";
  const labels = {
    collected: "已采集",
    partial_collected: "部分采集",
    missing: "缺失",
    failed: "失败",
    success: "成功",
    success_with_failures: "部分成功",
    success_with_review: "成功待复核",
    updated: "已写入",
    written: "已写入",
    ready_to_write: "可写入",
    dry_run_ready: "预演就绪",
    ready_for_write_test: "字段就绪",
    template_ready: "模板就绪",
    pending: "待复核",
    approved: "已通过",
    needs_changes: "需修改",
    idle: "空闲",
    running: "运行中",
    cancelling: "取消中",
    cancelled: "已取消",
    skipped: "已跳过",
    skipped_duplicate: "重复跳过",
    gemini: "Gemini",
    needs_recovery: "需要恢复",
    watch: "需关注",
    ready: "可生产",
    created: "已创建",
    partial_failed: "部分失败",
    nothing_to_create: "无需新增",
    confirmation_required: "待确认",
    empty: "无历史",
    needs_confirmation: "需二次确认",
    blocked_type_conflict: "类型冲突",
    needs_feishu_config: "待配置飞书",
    needs_review: "待复核",
    taxonomy_not_synced: "待同步标签库",
    not_written: "未写入",
    skipped_dry_run: "预演跳过",
    blocked_taxonomy_review: "标签阻塞",
    disabled: "已关闭",
  };
  const key = String(value ?? "");
  return labels[key] ?? value;
}

function batchModeLabel(value) {
  const labels = {
    batch: "批量",
    dry_run: "预演",
    execute: "执行",
  };
  return labels[String(value ?? "")] ?? (value || "-");
}

function statusTone(value) {
  if (["collected", "ready_to_write", "updated", "written", "success", "ready_for_write_test", "ready"].includes(value)) return "good";
  if (["partial_collected", "success_with_failures", "success_with_review", "dry_run_ready", "taxonomy_review_required", "template_ready", "cancelling", "cancelled", "needs_recovery", "empty", "needs_review", "taxonomy_not_synced", "skipped_dry_run", "blocked_taxonomy_review", "not_written"].includes(value)) return "warn";
  if (!value || value === "missing" || value === "failed" || value === "invalid" || value === "watch") return "bad";
  return "";
}

function fieldItem(label, value) {
  return `<div class="field-item"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(value)}</div></div>`;
}

function shot(item) {
  return `<a class="shot" href="${escapeAttr(item.href)}" data-shot-preview data-shot-name="${escapeAttr(item.name)}">
    <img src="${escapeAttr(item.href)}" alt="${escapeAttr(item.name)}">
    <span>${escapeHtml(item.name)}</span>
  </a>`;
}

function list(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "<p>-</p>";
  return `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function joinValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function reviewSyncText(sync) {
  if (!sync) return "";
  if (sync.status === "written" || sync.status === "updated") return `飞书已同步 ${formatDateTime(sync.synced_at)}`;
  if (sync.status === "skipped") {
    if (sync.reason === "missing_evaluation_files") return "飞书未同步：缺少评测结果";
    if (sync.reason === "feishu_not_configured") return "飞书未同步：未配置";
    if (sync.reason === "sync_disabled") return "飞书未同步";
    return "飞书未同步";
  }
  if (sync.status === "missing_fields") return "飞书未同步：字段缺失";
  if (sync.status === "failed") return "飞书同步失败";
  return `飞书状态：${sync.status}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatElapsed(ms) {
  const seconds = Math.round(Number(ms ?? 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function formatDuration(ms) {
  const seconds = Math.round(Number(ms ?? 0) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}
