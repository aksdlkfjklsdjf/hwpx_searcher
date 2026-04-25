const payload = JSON.parse(document.getElementById("payload").textContent);
const state = {
  documents: [],
  localDocuments: [],
  scanErrors: [],
  rhwp: null,
  rhwpWasmBytes: null,
  wasmSource: "",
  searchResults: [],
  searchRun: 0,
  searching: false,
  preview: null,
  scanned: 0,
  totalMatches: 0,
  workerSupported: typeof Worker !== "undefined",
  maxWorkers: Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2)),
  lastWorkerCount: 0,
  workerFallbackError: "",
  workerUrl: null,
  theme: "light",
  themePreference: "system",
  language: "en",
  statusKey: "loading",
  statusState: "busy",
  dragDepth: 0,
};

const THEME_STORAGE_KEY = "hwp-search-theme";
const LANGUAGE_STORAGE_KEY = "hwp-search-language";
const GROUP_LEVEL = Object.freeze({
  file: "file",
  page: "page",
  detail: "detail",
});
const systemThemeMedia = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

const appWindowEl = document.querySelector(".app-window");
const statusEl = document.getElementById("status");
const languageSelectEl = document.getElementById("language-select");
const themeSelectEl = document.getElementById("theme-select");
const themeButtonEl = document.getElementById("theme-button");
const themeButtonLabelEl = document.getElementById("theme-button-label");
const searchEl = document.getElementById("search");
const searchButtonEl = document.getElementById("search-button");
const groupLevelEl = document.getElementById("group-level");
const groupLevelSliderEl = document.getElementById("group-level-slider");
const groupLevelButtons = Array.from(document.querySelectorAll("[data-group-level]"));
const workerCountEl = document.getElementById("worker-count");
const caseEl = document.getElementById("case");
const hwpFilterEl = document.getElementById("filter-hwp");
const hwpxFilterEl = document.getElementById("filter-hwpx");
const pathFilterEl = document.getElementById("path-filter");
const folderInputEl = document.getElementById("folder-input");
const fileStateEl = document.getElementById("file-state");
const sourceCountEl = document.getElementById("source-count");
const metricDocsEl = document.getElementById("metric-docs");
const metricScannedEl = document.getElementById("metric-scanned");
const metricMatchesEl = document.getElementById("metric-matches");
const metricWorkersEl = document.getElementById("metric-workers");
const metricErrorsEl = document.getElementById("metric-errors");
const progressEl = document.getElementById("progress");
const summaryEl = document.getElementById("summary");
const resultsEl = document.getElementById("results");
const pageEl = document.getElementById("page");
const viewerTitleEl = document.getElementById("viewer-title");
const viewerSourceEl = document.getElementById("viewer-source");
const previewOverlayEl = document.getElementById("preview-overlay");
const previewCloseEl = document.getElementById("preview-close");
const dropOverlayEl = document.getElementById("drop-overlay");

initializeLanguage();
initializeTheme();
installMeasureTextWidth();

try {
  const moduleUrl = URL.createObjectURL(new Blob([payload.rhwpJs], { type: "text/javascript" }));
  const rhwp = await import(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  const rhwpWasm = await WasmLoader.loadRhwpWasmBytes(payload);
  await rhwp.default({ module_or_path: rhwpWasm.bytes });
  state.rhwp = rhwp;
  state.rhwpWasmBytes = rhwpWasm.bytes;
  state.wasmSource = rhwpWasm.source;

  populateWorkerOptions();
  syncDocuments();

  searchButtonEl.addEventListener("click", () => {
    void runSearch();
  });
  searchEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  });
  caseEl.addEventListener("change", clearSearchResults);
  hwpFilterEl.addEventListener("change", handleFilterChange);
  hwpxFilterEl.addEventListener("change", handleFilterChange);
  pathFilterEl.addEventListener("input", handleFilterChange);
  groupLevelEl.addEventListener("change", handleGroupLevelChange);
  groupLevelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setGroupLevel(button.dataset.groupLevel);
    });
  });
  workerCountEl.addEventListener("change", () => {
    state.lastWorkerCount = resolveWorkerCount();
    renderMetrics();
  });
  folderInputEl.addEventListener("change", async () => {
    await loadSelectedFiles(Array.from(folderInputEl.files || []));
  });
  appWindowEl.addEventListener("dragenter", handleDragEnter);
  appWindowEl.addEventListener("dragover", handleDragOver);
  appWindowEl.addEventListener("dragleave", handleDragLeave);
  appWindowEl.addEventListener("drop", handleDrop);
  previewCloseEl.addEventListener("click", closePreview);
  previewOverlayEl.addEventListener("click", (event) => {
    if (event.target === previewOverlayEl) {
      closePreview();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !previewOverlayEl.hidden) {
      closePreview();
    }
  });

  setStatus("ready");
  renderPreview();
  renderIdleSummary();
  updateReadyState();

  window.__HWP_SINGLE_HTML_TEST__ = {
    loadFiles: async (items) => {
      await loadSelectedFiles(filesFromTestItems(items));
      return diagnosticState();
    },
    dropFiles: async (items) => {
      await loadDroppedDataTransfer({ items: [], files: filesFromTestItems(items) });
      return diagnosticState();
    },
    search: async (query) => {
      searchEl.value = query;
      await runSearch();
      return diagnosticState();
    },
    setTheme: async (theme) => {
      applyThemePreference(theme);
      return diagnosticState();
    },
    setLanguage: async (language) => {
      applyLanguagePreference(language);
      writeStoredLanguage(state.language);
      return diagnosticState();
    },
    state: diagnosticState,
  };
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  setStatus("error", "error");
  pageEl.innerHTML = "";
  const pre = document.createElement("pre");
  pre.className = "error";
  pre.textContent = message;
  pageEl.append(pre);
  window.__HWP_SINGLE_HTML_READY__ = { ok: false, error: message };
}

async function runSearch() {
  if (!state.rhwp) {
    throw new Error("rhwp is not initialized");
  }
  const query = searchEl.value;
  if (!query) {
    clearSearchResults();
    return;
  }
  if (state.documents.length === 0) {
    summaryEl.textContent = state.localDocuments.length === 0 ? t("summary.chooseFolder") : t("summary.noFilesMatch");
    return;
  }

  const runId = ++state.searchRun;
  state.searching = true;
  state.searchResults = [];
  state.scanErrors = [];
  state.preview = null;
  state.scanned = 0;
  state.totalMatches = 0;
  state.workerFallbackError = "";
  searchButtonEl.disabled = true;
  workerCountEl.disabled = true;
  const workerCount = resolveWorkerCount();
  state.lastWorkerCount = workerCount;
  setStatus("searching", "busy");
  progressEl.hidden = false;
  progressEl.value = 0;
  progressEl.max = Math.max(1, state.documents.length);
  resultsEl.textContent = "";
  renderPreview();
  renderMetrics();

  if (state.workerSupported && workerCount > 0) {
    await searchWithWorkers(runId, query, caseEl.checked, workerCount);
  } else {
    await searchSequentially(runId, query, caseEl.checked);
  }

  state.searching = false;
  searchButtonEl.disabled = false;
  workerCountEl.disabled = false;
  progressEl.hidden = true;
  setStatus("ready");
  renderSearchSummary(state.totalMatches);
  renderResultList(query, caseEl.checked);
  renderMetrics();
  updateReadyState();
}

async function searchDescriptor(documentIndex, descriptor, query, caseSensitive) {
  const bytes = await descriptor.getBytes();
  const doc = new state.rhwp.HwpDocument(bytes);
  try {
    const pages = doc.pageCount();
    const occurrences = [];
    let count = 0;
    let previewPage = -1;

    for (let page = 0; page < pages; page += 1) {
      const text = extractPageText(doc, page);
      const matches = findTextMatches(text, query, caseSensitive);
      if (matches.length > 0 && previewPage === -1) {
        previewPage = page;
      }
      count += matches.length;
      for (const match of matches) {
        occurrences.push({
          page: page + 1,
          index: match.index,
          length: match.length,
          snippet: match.snippet,
        });
      }
    }

    return {
      documentIndex,
      name: descriptor.source === "folder" ? descriptor.path : descriptor.name,
      format: descriptor.format,
      rawFormat: descriptor.format,
      path: descriptor.path,
      source: descriptor.source,
      pages,
      count,
      occurrences,
      previewPage,
    };
  } finally {
    doc.free();
  }
}

async function searchSequentially(runId, query, caseSensitive) {
  state.lastWorkerCount = 1;
  for (const [documentIndex, descriptor] of state.documents.entries()) {
    if (runId !== state.searchRun) {
      return;
    }
    summaryEl.textContent = t("summary.progress", { scanned: documentIndex + 1, total: state.documents.length });
    try {
      const result = await searchDescriptor(documentIndex, descriptor, query, caseSensitive);
      handleSearchResult(result, query, caseSensitive);
    } catch (error) {
      handleSearchError(descriptor.path, error);
    }
  }
}

async function searchWithWorkers(runId, query, caseSensitive, workerCount) {
  const workers = [];
  let nextIndex = 0;

  try {
    for (let index = 0; index < workerCount; index += 1) {
      const worker = createSearchWorker();
      workers.push(worker);
      await worker.ready;
    }

    await Promise.all(workers.map((worker) => runWorkerLane(worker)));
  } catch (error) {
    if (state.scanned === 0) {
      state.workerFallbackError = error instanceof Error ? error.message : String(error);
      await searchSequentially(runId, query, caseSensitive);
    } else {
      state.scanErrors.push({
        path: "worker-pool",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    for (const worker of workers) {
      worker.terminate();
    }
  }

  async function runWorkerLane(worker) {
    while (nextIndex < state.documents.length && runId === state.searchRun) {
      const documentIndex = nextIndex;
      nextIndex += 1;
      const descriptor = state.documents[documentIndex];
      summaryEl.textContent = t("summary.progress", { scanned: state.scanned, total: state.documents.length });

      try {
        const bytes = await descriptor.getBytes();
        const buffer = transferableBuffer(bytes);
        const result = await worker.search({
          documentIndex,
          descriptor: publicDescriptor(descriptor),
          query,
          caseSensitive,
          bytes: buffer,
        }, [buffer]);
        handleSearchResult(result, query, caseSensitive);
      } catch (error) {
        handleSearchError(descriptor.path, error);
      }
    }
  }
}

function handleSearchResult(result, query, caseSensitive) {
  state.scanned += 1;
  progressEl.value = state.scanned;
  if (result.count > 0) {
    result.query = query;
    result.caseSensitive = caseSensitive;
    result.rawFormat = state.documents[result.documentIndex]?.format || result.rawFormat || result.format;
    state.searchResults.push(result);
    state.searchResults.sort((a, b) => a.documentIndex - b.documentIndex);
    state.totalMatches += result.count;
    renderResultList(query, caseSensitive);
  }
  summaryEl.textContent = t("summary.progress", { scanned: state.scanned, total: state.documents.length });
  renderMetrics();
}

function handleSearchError(path, error) {
  state.scanned += 1;
  progressEl.value = state.scanned;
  state.scanErrors.push({
    path,
    error: error instanceof Error ? error.message : String(error),
  });
  summaryEl.textContent = t("summary.progress", { scanned: state.scanned, total: state.documents.length });
  renderMetrics();
}

function publicDescriptor(descriptor) {
  return {
    name: descriptor.name,
    label: descriptor.label,
    format: descriptor.format,
    path: descriptor.path,
    repoPath: descriptor.repoPath,
    source: descriptor.source,
  };
}

function transferableBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function handleFilterChange() {
  state.searchRun += 1;
  state.searching = false;
  state.searchResults = [];
  state.scanErrors = [];
  state.preview = null;
  state.scanned = 0;
  state.totalMatches = 0;
  state.workerFallbackError = "";
  searchButtonEl.disabled = false;
  progressEl.hidden = true;
  setStatus("ready");
  syncDocuments();
  renderPreview();
  renderIdleSummary();
  updateReadyState();
}

function handleGroupLevelChange() {
  syncGroupLevelSlider(currentGroupLevel());
  if (state.searchResults.length > 0) {
    renderResultList(searchEl.value, caseEl.checked);
  }
  updateReadyState();
}

function setGroupLevel(groupLevel) {
  const nextGroupLevel = Object.values(GROUP_LEVEL).includes(groupLevel) ? groupLevel : GROUP_LEVEL.page;
  if (groupLevelEl.value === nextGroupLevel) {
    syncGroupLevelSlider(nextGroupLevel);
    return;
  }
  groupLevelEl.value = nextGroupLevel;
  groupLevelEl.dispatchEvent(new Event("change", { bubbles: true }));
}

function syncGroupLevelSlider(groupLevel) {
  groupLevelSliderEl.dataset.value = groupLevel;
  for (const button of groupLevelButtons) {
    button.setAttribute("aria-checked", String(button.dataset.groupLevel === groupLevel));
  }
}

function syncDocuments() {
  const pathNeedle = pathFilterEl.value.trim().toLocaleLowerCase();
  state.documents = state.localDocuments.filter((doc) => {
    const format = doc.format.toLocaleLowerCase();
    const typeAllowed = (format === "hwp" && hwpFilterEl.checked) || (format === "hwpx" && hwpxFilterEl.checked);
    const pathAllowed = !pathNeedle || doc.path.toLocaleLowerCase().includes(pathNeedle);
    return typeAllowed && pathAllowed;
  });
  state.lastWorkerCount = resolveWorkerCount();
  renderMetrics();
}

function initializeLanguage() {
  const initialLanguage = readLanguageFromUrl() || readStoredLanguage() || "en";
  applyLanguagePreference(initialLanguage);
  languageSelectEl.addEventListener("change", () => {
    applyLanguagePreference(languageSelectEl.value);
    writeStoredLanguage(state.language);
    if (window.__HWP_SINGLE_HTML_READY__) {
      updateReadyState();
    }
  });
}

function applyLanguagePreference(language) {
  const currentWorkerValue = workerCountEl.value || "auto";
  state.language = I18n.setLanguage(language);
  languageSelectEl.value = state.language;
  I18n.translateDocument();
  syncThemeButton();
  setStatus(state.statusKey, state.statusState);
  populateWorkerOptions(currentWorkerValue);
  renderMetrics();
  renderPreview();
  if (state.searchResults.length > 0) {
    renderSearchSummary(state.totalMatches);
    renderResultList(searchEl.value, caseEl.checked);
  } else if (!state.searching) {
    renderIdleSummary();
  }
}

function readLanguageFromUrl() {
  try {
    const language = new URLSearchParams(window.location.search).get("lang");
    return I18n.normalizeLanguage(language) === language ? language : "";
  } catch {
    return "";
  }
}

function readStoredLanguage() {
  try {
    const language = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return I18n.normalizeLanguage(language) === language ? language : "";
  } catch {
    return "";
  }
}

function writeStoredLanguage(language) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, I18n.normalizeLanguage(language));
  } catch {
    // Storage can be unavailable for locked-down local file contexts.
  }
}

function t(key, params) {
  return I18n.t(key, params);
}

function initializeTheme() {
  const initialPreference = readThemeFromUrl() || readStoredTheme() || "system";
  applyThemePreference(initialPreference);
  themeSelectEl.addEventListener("change", () => {
    applyThemePreference(themeSelectEl.value);
    writeStoredTheme(state.themePreference);
    if (window.__HWP_SINGLE_HTML_READY__) {
      updateReadyState();
    }
  });
  themeButtonEl.addEventListener("click", () => {
    applyThemePreference(nextThemePreference());
    writeStoredTheme(state.themePreference);
    if (window.__HWP_SINGLE_HTML_READY__) {
      updateReadyState();
    }
  });

  if (!systemThemeMedia) {
    return;
  }

  const handleSystemThemeChange = () => {
    if (state.themePreference === "system") {
      applyThemePreference("system");
      if (window.__HWP_SINGLE_HTML_READY__) {
        updateReadyState();
      }
    }
  };

  if (typeof systemThemeMedia.addEventListener === "function") {
    systemThemeMedia.addEventListener("change", handleSystemThemeChange);
  } else if (typeof systemThemeMedia.addListener === "function") {
    systemThemeMedia.addListener(handleSystemThemeChange);
  }
}

function applyThemePreference(preference) {
  const normalizedPreference = normalizeThemePreference(preference);
  const systemTheme = systemThemeMedia?.matches ? "dark" : "light";
  const resolvedTheme = normalizedPreference === "system" ? systemTheme : normalizedPreference;
  state.themePreference = normalizedPreference;
  state.theme = resolvedTheme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = normalizedPreference;
  document.documentElement.style.colorScheme = resolvedTheme;
  themeSelectEl.value = normalizedPreference;
  syncThemeButton();
}

function syncThemeButton() {
  themeButtonEl.dataset.themePreference = state.themePreference;
  themeButtonLabelEl.textContent = t("theme." + state.themePreference);
}

function nextThemePreference() {
  if (state.themePreference === "system") {
    return "light";
  }
  if (state.themePreference === "light") {
    return "dark";
  }
  return "system";
}

function normalizeThemePreference(preference) {
  return isThemePreference(preference) ? preference : "system";
}

function readThemeFromUrl() {
  try {
    const theme = new URLSearchParams(window.location.search).get("theme");
    return isThemePreference(theme) ? theme : "";
  } catch {
    return "";
  }
}

function readStoredTheme() {
  try {
    const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(theme) ? theme : "";
  } catch {
    return "";
  }
}

function isThemePreference(value) {
  return value === "light" || value === "dark" || value === "system";
}

function writeStoredTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizeThemePreference(theme));
  } catch {
    // Storage can be unavailable for locked-down local file contexts.
  }
}

function updateReadyState() {
  window.__HWP_SINGLE_HTML_READY__ = diagnosticState();
}

function diagnosticState() {
  return {
    ok: true,
    parsedOnLoad: false,
    sampleCount: 0,
    localCount: state.localDocuments.length,
    documentCount: state.documents.length,
    scanErrors: state.scanErrors.length,
    scanned: state.scanned,
    totalMatches: state.totalMatches,
    workerSupported: state.workerSupported,
    workerCount: state.lastWorkerCount,
    maxWorkers: state.maxWorkers,
    workerFallbackError: state.workerFallbackError,
    wasmSource: state.wasmSource,
    searchResultCount: state.searchResults.length,
    theme: state.theme,
    themePreference: state.themePreference,
    language: state.language,
    groupLevel: groupLevelEl.value,
    previewOpen: Boolean(state.preview),
    samples: state.documents.map(({ name, format, source, path }) => ({
      name,
      format,
      source,
      path,
      loaded: false,
    })),
    results: state.searchResults.map(({ name, format, pages, count, path }) => ({
      name,
      format,
      pages,
      count,
      path,
    })),
  };
}

function renderIdleSummary() {
  if (state.documents.length === 0 && state.localDocuments.length > 0) {
    summaryEl.textContent = t("summary.noFilesMatch");
  } else {
    summaryEl.textContent = state.documents.length === 0
      ? t("summary.idle")
      : t("summary.queued", { count: state.documents.length });
  }
  resultsEl.textContent = "";
  renderMetrics();
}

function renderSearchSummary(totalMatches) {
  const errorNote = state.scanErrors.length > 0 ? t("summary.errors", { count: state.scanErrors.length }) : "";
  summaryEl.textContent = t("summary.search", {
    matches: totalMatches,
    files: state.searchResults.length,
    errors: errorNote,
  });
}

function clearSearchResults() {
  state.searchRun += 1;
  state.searching = false;
  state.searchResults = [];
  state.scanErrors = [];
  state.preview = null;
  state.scanned = 0;
  state.totalMatches = 0;
  state.workerFallbackError = "";
  searchButtonEl.disabled = false;
  progressEl.hidden = true;
  setStatus("ready");
  renderPreview();
  renderIdleSummary();
  updateReadyState();
}

function renderMetrics() {
  sourceCountEl.textContent = state.localDocuments.length > 0 && state.documents.length !== state.localDocuments.length
    ? t("summary.queuedFiltered", { visible: state.documents.length, total: state.localDocuments.length })
    : t("summary.queued", { count: state.documents.length });
  metricDocsEl.textContent = String(state.documents.length);
  metricScannedEl.textContent = String(state.scanned);
  metricMatchesEl.textContent = String(state.totalMatches);
  metricWorkersEl.textContent = String(state.lastWorkerCount || resolveWorkerCount());
  metricErrorsEl.textContent = String(state.scanErrors.length);
}

function setStatus(key, stateName = "ready") {
  state.statusKey = key;
  state.statusState = stateName;
  statusEl.textContent = t("status." + key);
  statusEl.dataset.state = stateName;
}

function createSearchWorker() {
  return SearchWorkerClient.create({
    workerUrl: getWorkerUrl(),
    rhwpJs: payload.rhwpJs,
    rhwpWasmBytes: state.rhwpWasmBytes,
  });
}

function getWorkerUrl() {
  if (!state.workerUrl) {
    state.workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
  }
  return state.workerUrl;
}

function workerSource() {
  return payload.workerJs;
}

function populateWorkerOptions(preferredValue = workerCountEl.value || "auto") {
  workerCountEl.textContent = "";
  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = t("worker.auto");
  workerCountEl.append(autoOption);

  for (let count = 1; count <= state.maxWorkers; count += 1) {
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = t("worker.count", { count });
    workerCountEl.append(option);
  }

  workerCountEl.value = [...workerCountEl.options].some((option) => option.value === preferredValue) ? preferredValue : "auto";
  workerCountEl.disabled = !state.workerSupported;
}

function resolveWorkerCount() {
  if (!state.workerSupported) {
    return 1;
  }

  const selected = workerCountEl.value;
  if (selected !== "auto") {
    return Math.max(1, Math.min(Number(selected) || 1, state.maxWorkers, Math.max(1, state.documents.length || 1)));
  }

  const automatic = Math.max(1, Math.min(4, state.maxWorkers));
  return Math.max(1, Math.min(automatic, Math.max(1, state.documents.length || 1)));
}

function installMeasureTextWidth() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  globalThis.measureTextWidth = (font, text) => {
    context.font = font;
    return context.measureText(text).width;
  };
}
