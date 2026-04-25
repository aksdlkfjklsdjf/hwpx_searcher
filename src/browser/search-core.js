function findTextMatches(text, query, caseSensitive) {
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const output = [];
  let index = 0;

  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    output.push({
      index: found,
      length: query.length,
      snippet: makeSnippet(text, found, query.length),
    });
    index = found + Math.max(needle.length, 1);
  }

  return output;
}

function makeSnippet(text, index, length) {
  const radius = 64;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function extractPageText(doc, page) {
  return extractTextFromLayout(JSON.parse(doc.getPageTextLayout(page)));
}

function extractTextFromLayout(layout) {
  return (layout.runs || [])
    .map((run) => typeof run.text === "string" ? run.text : "")
    .join("")
    .replace(/\uFFFC/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function normalizeRunTextWithMap(text) {
  let normalized = "";
  const map = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(char)) {
      continue;
    }
    normalized += char === "\uFFFC" ? " " : char;
    map.push(index);
  }
  return { text: normalized, map };
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
