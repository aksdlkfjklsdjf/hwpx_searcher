let rhwp = null;

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === "init") {
      installMeasureTextWidth();
      const moduleUrl = URL.createObjectURL(new Blob([message.rhwpJs], { type: "text/javascript" }));
      rhwp = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      await rhwp.default({ module_or_path: new Uint8Array(message.rhwpWasmBytes) });
      self.postMessage({ type: "ready" });
      return;
    }

    if (message.type === "search") {
      const result = searchDocument(message.task);
      self.postMessage({ type: "result", id: message.id, result });
    }
  } catch (error) {
    self.postMessage({
      type: message.type === "init" ? "init-error" : "error",
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

function searchDocument(task) {
  const descriptor = task.descriptor;
  const doc = new rhwp.HwpDocument(new Uint8Array(task.bytes));
  try {
    const pages = doc.pageCount();
    const occurrences = [];
    let count = 0;
    let previewPage = -1;

    for (let page = 0; page < pages; page += 1) {
      const text = extractPageText(doc, page);
      const matches = findTextMatches(text, task.query, task.caseSensitive);
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
      documentIndex: task.documentIndex,
      name: descriptor.source === "folder" ? descriptor.path : descriptor.name,
      format: descriptor.source === "folder" ? descriptor.format + " · local" : descriptor.format,
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

function installMeasureTextWidth() {
  let context = null;
  globalThis.measureTextWidth = (font, text) => {
    if (typeof OffscreenCanvas !== "undefined") {
      context ||= new OffscreenCanvas(1, 1).getContext("2d");
      context.font = font;
      return context.measureText(text).width;
    }
    let width = 0;
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 12);
    for (const char of text) {
      width += char.codePointAt(0) > 0x2e80 ? size * 0.95 : size * 0.55;
    }
    return width;
  };
}
