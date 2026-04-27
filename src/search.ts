import type { HwpDocument } from "@rhwp/core";
import { loadHwpDocument } from "./rhwp.js";
import { findTextMatches } from "./text-match.js";

export interface SearchOptions {
  caseSensitive: boolean;
  maxSnippetsPerFile: number;
  snippetRadius: number;
}

export interface SearchOccurrence {
  page: number;
  index: number;
  snippet: string;
}

export interface SearchResult {
  file: string;
  matches: number;
  occurrences: SearchOccurrence[];
  pages: number;
}

export interface SearchError {
  file: string;
  error: string;
}

interface PageTextLayout {
  runs?: Array<{ text?: unknown; x?: unknown; y?: unknown }>;
}

export async function searchHwpFile(
  filePath: string,
  query: string,
  options: SearchOptions,
): Promise<SearchResult> {
  const doc = await loadHwpDocument(filePath);

  try {
    const pages = Math.max(0, doc.pageCount());
    const occurrences: SearchOccurrence[] = [];
    let matchCount = 0;

    for (let page = 0; page < pages; page += 1) {
      const text = extractPageText(doc, page);
      const matches = findTextMatches(text, query, options.caseSensitive, options.snippetRadius);
      matchCount += matches.length;

      for (const match of matches) {
        if (occurrences.length >= options.maxSnippetsPerFile) {
          break;
        }

        occurrences.push({
          page: page + 1,
          index: match.index,
          snippet: match.snippet,
        });
      }
    }

    return {
      file: filePath,
      matches: matchCount,
      occurrences,
      pages,
    };
  } finally {
    doc.free();
  }
}

function extractPageText(doc: HwpDocument, page: number): string {
  const raw = doc.getPageTextLayout(page);
  const layout = parsePageTextLayout(raw);
  const runs = Array.isArray(layout.runs) ? layout.runs : [];

  return runs
    .map((run) => (typeof run.text === "string" ? cleanRunText(run.text) : ""))
    .filter((text) => text.length > 0)
    .join("");
}

function cleanRunText(text: string): string {
  return text
    .replace(/\uFFFC/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function parsePageTextLayout(raw: string): PageTextLayout {
  try {
    return JSON.parse(raw) as PageTextLayout;
  } catch (error) {
    if (!isControlCharacterJsonError(error)) {
      throw error;
    }
    return JSON.parse(escapeRawControlCharactersInJsonStrings(raw)) as PageTextLayout;
  }
}

function isControlCharacterJsonError(error: unknown): boolean {
  return error instanceof SyntaxError && /control character/i.test(error.message);
}

function escapeRawControlCharactersInJsonStrings(raw: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    const code = char.charCodeAt(0);

    if (!inString) {
      output += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
    } else if (char === "\\") {
      output += char;
      escaped = true;
    } else if (char === '"') {
      output += char;
      inString = false;
    } else if (code <= 0x1f) {
      output += "\\u" + code.toString(16).padStart(4, "0");
    } else {
      output += char;
    }
  }

  return output;
}
