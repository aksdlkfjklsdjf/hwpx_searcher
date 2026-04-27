function filesFromTestItems(items) {
  return items.map((item) => ({
    name: item.name,
    webkitRelativePath: item.relativePath || item.name,
    size: item.size ?? Math.floor((item.base64?.length || 0) * 3 / 4),
    lastModified: item.lastModified ?? 0,
    arrayBuffer: async () => base64ToBytes(item.base64).buffer,
  }));
}

async function loadSelectedFiles(files) {
  const hwpFiles = files
    .filter(isHwpLikeFile)
    .sort((a, b) => filePathOf(a).localeCompare(filePathOf(b)));

  state.localDocuments = [];
  state.scanErrors = [];
  state.searchResults = [];
  state.preview = null;
  state.scanned = 0;
  state.totalMatches = 0;
  state.storedFileCount = 0;

  if (hwpFiles.length === 0) {
    await clearStoredFiles();
    fileStateEl.textContent = t("index.noHwpFiles");
    syncDocuments();
    renderPreview();
    renderIdleSummary();
    updateReadyState();
    return;
  }

  state.localDocuments = await createDocumentDescriptors(hwpFiles);

  syncDocuments();
  setStatus("ready");
  fileStateEl.textContent = t("summary.queued", { count: state.localDocuments.length });
  renderPreview();
  renderIdleSummary();
  updateReadyState();
}

function handleDragEnter(event) {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  state.dragDepth += 1;
  showDropOverlay(true);
}

function handleDragOver(event) {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  showDropOverlay(true);
}

function handleDragLeave(event) {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) {
    showDropOverlay(false);
  }
}

async function handleDrop(event) {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  state.dragDepth = 0;
  showDropOverlay(false);
  await loadDroppedDataTransfer(event.dataTransfer);
}

function isFileDrag(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes("Files") || (event.dataTransfer?.files?.length ?? 0) > 0;
}

function showDropOverlay(active) {
  dropOverlayEl.hidden = !active;
}

async function loadDroppedDataTransfer(dataTransfer) {
  try {
    setStatus("indexing", "busy");
    const files = await collectDroppedFiles(dataTransfer);
    await loadSelectedFiles(files);
  } catch (error) {
    state.scanErrors = [{
      path: "drag-drop",
      error: error instanceof Error ? error.message : String(error),
    }];
    fileStateEl.textContent = t("index.dropFailed");
    setStatus("error", "error");
    renderMetrics();
    updateReadyState();
  }
}

async function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entryItems = items
    .map((item) => typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null)
    .filter(Boolean);

  if (entryItems.length > 0) {
    const files = [];
    for (const entry of entryItems) {
      await collectEntryFiles(entry, "", files);
    }
    if (files.length > 0) {
      return files;
    }
  }

  const itemFiles = items
    .map((item) => item.kind === "file" && typeof item.getAsFile === "function" ? item.getAsFile() : null)
    .filter(Boolean);
  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return Array.from(dataTransfer?.files || []);
}

async function collectEntryFiles(entry, prefix, output) {
  if (entry.isFile) {
    await new Promise((resolve, reject) => {
      entry.file((file) => {
        output.push(fileWithRelativePath(file, prefix + file.name));
        resolve();
      }, reject);
    });
    return;
  }

  if (!entry.isDirectory) {
    return;
  }

  const reader = entry.createReader();
  const directoryPrefix = prefix + entry.name + "/";
  while (true) {
    const entries = await readDirectoryEntries(reader);
    if (entries.length === 0) {
      break;
    }
    for (const child of entries) {
      await collectEntryFiles(child, directoryPrefix, output);
    }
  }
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function createDocumentDescriptors(files) {
  const records = files.map((file) => ({
    id: "folder:" + filePathOf(file),
    name: file.name,
    label: filePathOf(file),
    format: extensionOf(file.name).toUpperCase(),
    path: filePathOf(file),
    repoPath: filePathOf(file),
    source: "folder",
    size: file.size ?? 0,
    lastModified: file.lastModified ?? 0,
    file,
  }));

  if (!BrowserFileStore.isSupported()) {
    state.fileStorage = "memory";
    state.storedFileCount = 0;
    return records.map((record) => memoryDescriptor(record));
  }

  try {
    const stored = await BrowserFileStore.replaceFiles(records);
    state.fileStorage = "indexeddb";
    state.storedFileCount = stored.length;
    return stored.map((record) => indexedDbDescriptor(record));
  } catch (error) {
    state.fileStorage = "memory";
    state.storedFileCount = 0;
    state.scanErrors.push({
      path: "indexeddb",
      error: error instanceof Error ? error.message : String(error),
    });
    return records.map((record) => memoryDescriptor(record));
  }
}

function indexedDbDescriptor(record) {
  return {
    ...record,
    getBytes: async () => BrowserFileStore.getBytes(record.id),
  };
}

function memoryDescriptor(record) {
  const { file, ...metadata } = record;
  return {
    ...metadata,
    getBytes: async () => new Uint8Array(await file.arrayBuffer()),
  };
}

async function clearStoredFiles() {
  if (!BrowserFileStore.isSupported()) {
    state.fileStorage = "memory";
    state.storedFileCount = 0;
    return;
  }

  try {
    await BrowserFileStore.clear();
    state.fileStorage = "indexeddb";
    state.storedFileCount = 0;
  } catch {
    state.fileStorage = "memory";
    state.storedFileCount = 0;
  }
}

function fileWithRelativePath(file, relativePath) {
  if (!relativePath) {
    return file;
  }
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    webkitRelativePath: relativePath,
    blob: file,
    arrayBuffer: () => file.arrayBuffer(),
  };
}

function isHwpLikeFile(file) {
  const ext = extensionOf(file.name || filePathOf(file));
  return ext === "hwp" || ext === "hwpx";
}

function filePathOf(file) {
  return file.webkitRelativePath || file.name || "untitled";
}

function extensionOf(fileName) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLocaleLowerCase() : "";
}
