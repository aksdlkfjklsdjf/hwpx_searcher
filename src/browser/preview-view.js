function renderPreview() {
  if (state.preview) {
    previewOverlayEl.hidden = false;
    viewerTitleEl.textContent = previewTitle(state.preview);
    viewerSourceEl.textContent = state.preview.source;
    pageEl.innerHTML = state.preview.svg;
    return;
  }

  previewOverlayEl.hidden = true;
  viewerTitleEl.textContent = t("preview.title");
  viewerSourceEl.textContent = "";
  pageEl.textContent = "";
}

function closePreview() {
  state.preview = null;
  renderPreview();
  if (window.__HWP_SINGLE_HTML_READY__) {
    updateReadyState();
  }
}

async function showResultPreview(item, pageIndex = item.previewPage) {
  const targetPage = Number.isFinite(pageIndex) ? pageIndex : item.previewPage;

  if (item.previewByPage?.[targetPage]) {
    state.preview = item.previewByPage[targetPage];
    renderPreview();
    return;
  }

  const descriptor = state.documents[item.documentIndex];
  if (!descriptor || targetPage < 0) {
    state.preview = null;
    renderPreview();
    return;
  }

  setStatus("preview", "busy");
  try {
    const bytes = await descriptor.getBytes();
    const doc = new state.rhwp.HwpDocument(bytes);
    try {
      const pageOccurrences = item.occurrences.filter((occurrence) => occurrence.page === targetPage + 1);
      const preview = {
        documentIndex: item.documentIndex,
        label: descriptor.label,
        page: targetPage + 1,
        pages: item.pages,
        source: descriptor.source === "folder" ? descriptor.path : descriptor.repoPath,
        svg: renderHighlightedPageSvg(doc, targetPage, item.query || searchEl.value, item.caseSensitive ?? caseEl.checked, pageOccurrences),
      };
      item.previewByPage ||= {};
      item.previewByPage[targetPage] = preview;
      state.preview = preview;
      renderPreview();
    } finally {
      doc.free();
    }
  } catch (error) {
    state.scanErrors.push({
      path: descriptor.path,
      error: error instanceof Error ? error.message : String(error),
    });
    renderMetrics();
  } finally {
    setStatus("ready");
  }
}

function previewTitle(preview) {
  if (preview.label && Number.isFinite(preview.page) && Number.isFinite(preview.pages)) {
    return t("preview.pageTitle", {
      label: preview.label,
      page: preview.page,
      pages: preview.pages,
    });
  }
  return preview.title || t("preview.title");
}

function renderHighlightedPageSvg(doc, page, query, caseSensitive, occurrences = []) {
  const svg = doc.renderPageSvg(page);
  const rects = buildDocumentHighlightRects(doc, page, query, caseSensitive, occurrences);
  if (rects.length === 0) {
    return svg;
  }

  const highlightLayer = '<g class="hwp-document-highlights" pointer-events="none">' + rects.map((rect) =>
    '<rect class="hwp-document-highlight" x="' + formatSvgNumber(rect.x) + '" y="' + formatSvgNumber(rect.y) + '" width="' + formatSvgNumber(rect.width) + '" height="' + formatSvgNumber(rect.height) + '" rx="' + formatSvgNumber(Math.min(3, rect.height * 0.18)) + '" fill="#fde047" fill-opacity="0.78" stroke="#f43f5e" stroke-opacity="0.95" stroke-width="2.2" vector-effect="non-scaling-stroke"/>'
  ).join("") + "</g>";
  const insertAt = svg.lastIndexOf("</svg>");
  if (insertAt === -1) {
    const openingEnd = svg.indexOf(">");
    return openingEnd === -1 ? svg : svg.slice(0, openingEnd + 1) + highlightLayer + svg.slice(openingEnd + 1);
  }
  return svg.slice(0, insertAt) + highlightLayer + svg.slice(insertAt);
}

function buildDocumentHighlightRects(doc, page, query, caseSensitive, occurrences = []) {
  if (!query) {
    return [];
  }

  const layout = parsePageTextLayout(doc.getPageTextLayout(page));
  const rawRunInfos = [];
  let textStart = 0;
  for (const run of layout.runs || []) {
    if (typeof run.text !== "string") {
      continue;
    }
    const normalized = normalizeRunTextWithMap(run.text);
    if (!normalized.text) {
      continue;
    }
    rawRunInfos.push({
      run,
      text: normalized.text,
      map: normalized.map,
      textStart,
    });
    textStart += normalized.text.length;
  }

  const occurrenceMatches = occurrences
    .filter((occurrence) => Number.isFinite(Number(occurrence.index)))
    .map((occurrence) => ({
      index: Number(occurrence.index),
      length: Math.max(1, Number(occurrence.length) || query.length),
    }));

  if (occurrenceMatches.length > 0) {
    const runInfos = rawRunInfos.map((info) => ({
      ...info,
      start: info.textStart,
    }));
    return rectsForMatches(runInfos, occurrenceMatches);
  }

  let fullText = "";
  const fallbackRunInfos = rawRunInfos.map((info) => {
    const start = fullText.length;
    fullText += info.text;
    return { ...info, start };
  });
  const matches = findTextMatches(fullText, query, caseSensitive).map((match) => ({
    index: match.index,
    length: match.length,
  }));
  return rectsForMatches(fallbackRunInfos, matches);
}

function rectsForMatches(runInfos, matches) {
  const rects = [];
  for (const match of matches) {
    const start = match.index;
    const end = match.index + match.length;
    for (const info of runInfos) {
      const runStart = info.start;
      const runEnd = info.start + info.text.length;
      if (end <= runStart || start >= runEnd) {
        continue;
      }

      const cleanStart = Math.max(start - runStart, 0);
      const cleanEnd = Math.min(end - runStart, info.text.length);
      const originalStart = info.map[cleanStart] ?? cleanStart;
      const originalEnd = (info.map[cleanEnd - 1] ?? cleanEnd - 1) + 1;
      const rect = rectForRunRange(info.run, originalStart, originalEnd);
      if (rect) {
        rects.push(rect);
      }
    }
  }
  return rects;
}

function rectForRunRange(run, start, end) {
  const x = numberOr(run.x, 0);
  const y = numberOr(run.y, 0);
  const width = numberOr(run.w, 0);
  const height = Math.max(numberOr(run.h, 0), numberOr(run.fontSize, 12) * 1.05);
  const charX = Array.isArray(run.charX) ? run.charX : [];
  const textLength = typeof run.text === "string" ? run.text.length : 0;
  const startOffset = charOffsetAt(charX, start, width, textLength);
  const endOffset = charOffsetAt(charX, end, width, textLength);
  const rectWidth = Math.max(2, endOffset - startOffset);
  return {
    x: x + startOffset - 1.5,
    y: y - 1,
    width: rectWidth + 3,
    height: height + 2,
  };
}

function charOffsetAt(charX, index, width, textLength) {
  const direct = Number(charX[index]);
  if (Number.isFinite(direct)) {
    return direct;
  }
  if (textLength <= 0) {
    return 0;
  }
  return width * Math.max(0, Math.min(index, textLength)) / textLength;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatSvgNumber(value) {
  return String(Math.round(value * 1000) / 1000);
}
