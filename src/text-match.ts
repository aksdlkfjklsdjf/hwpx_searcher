export interface TextMatch {
  index: number;
  length: number;
  snippet: string;
}

export function findTextMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  snippetRadius = 48,
): TextMatch[] {
  if (query.length === 0) {
    return [];
  }

  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  let fromIndex = 0;

  while (fromIndex <= haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) {
      break;
    }

    matches.push({
      index,
      length: query.length,
      snippet: makeSnippet(text, index, query.length, snippetRadius),
    });
    fromIndex = index + Math.max(needle.length, 1);
  }

  return matches;
}

function makeSnippet(text: string, index: number, length: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${prefix}${body}${suffix}`;
}
