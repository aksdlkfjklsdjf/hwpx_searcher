#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { walkHwpFiles } from "./file-walker.js";
import { searchHwpFile, type SearchError, type SearchResult } from "./search.js";

interface CliOptions {
  query: string;
  root: string;
  caseSensitive: boolean;
  json: boolean;
  includeErrors: boolean;
  strict: boolean;
  maxSnippetsPerFile: number;
  snippetRadius: number;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    return 0;
  }

  if (!options) {
    return 2;
  }

  const results: SearchResult[] = [];
  const errors: SearchError[] = [];
  let scanned = 0;

  for await (const file of walkHwpFiles(options.root)) {
    scanned += 1;

    try {
      const result = await searchHwpFile(file, options.query, {
        caseSensitive: options.caseSensitive,
        maxSnippetsPerFile: options.maxSnippetsPerFile,
        snippetRadius: options.snippetRadius,
      });

      if (result.matches > 0) {
        results.push(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ file, error: message });
      if (!options.json || options.includeErrors) {
        console.error(`Failed: ${path.relative(process.cwd(), file)}: ${message}`);
      }
    }
  }

  if (options.json) {
    const payload = {
      query: options.query,
      root: path.resolve(options.root),
      scanned,
      matchedFiles: results.length,
      matches: results.reduce((total, result) => total + result.matches, 0),
      results,
      errors: options.includeErrors ? errors : undefined,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanResults(results, scanned, errors.length);
  }

  if (options.strict && errors.length > 0) {
    return 2;
  }

  return results.length > 0 ? 0 : errors.length > 0 ? 2 : 1;
}

function parseArgs(args: string[]): CliOptions | "help" | undefined {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return "help";
  }

  const positional: string[] = [];
  let caseSensitive = false;
  let json = false;
  let includeErrors = false;
  let strict = false;
  let maxSnippetsPerFile = 5;
  let snippetRadius = 48;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--case-sensitive":
      case "-s":
        caseSensitive = true;
        break;
      case "--json":
        json = true;
        break;
      case "--include-errors":
        includeErrors = true;
        break;
      case "--strict":
        strict = true;
        break;
      case "--max-snippets":
        maxSnippetsPerFile = parsePositiveInteger(args[index + 1], "--max-snippets");
        if (Number.isNaN(maxSnippetsPerFile)) {
          return undefined;
        }
        index += 1;
        break;
      case "--snippet-radius":
        snippetRadius = parsePositiveInteger(args[index + 1], "--snippet-radius");
        if (Number.isNaN(snippetRadius)) {
          return undefined;
        }
        index += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          return undefined;
        }
        positional.push(arg);
        break;
    }
  }

  const [query, root = "."] = positional;
  if (!query) {
    printHelp();
    return undefined;
  }

  return {
    query,
    root,
    caseSensitive,
    json,
    includeErrors,
    strict,
    maxSnippetsPerFile,
    snippetRadius,
  };
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`${flag} requires a non-negative integer`);
    printHelp();
    return Number.NaN;
  }
  return parsed;
}

function printHumanResults(results: SearchResult[], scanned: number, errorCount: number): void {
  for (const result of results) {
    console.log(`${result.file} (${result.matches} match${result.matches === 1 ? "" : "es"}, ${result.pages} page${result.pages === 1 ? "" : "s"})`);

    for (const occurrence of result.occurrences) {
      console.log(`  page ${occurrence.page}: ${occurrence.snippet}`);
    }

    if (result.matches > result.occurrences.length) {
      console.log(`  ... ${result.matches - result.occurrences.length} more`);
    }
  }

  console.error(`Scanned ${scanned} HWP/HWPX file${scanned === 1 ? "" : "s"}; matched ${results.length} file${results.length === 1 ? "" : "s"}; errors ${errorCount}.`);
}

function printHelp(): void {
  console.log(`Usage: hwp-search <query> [root] [options]

Recursively search .hwp and .hwpx files using @rhwp/core.

Arguments:
  query                 Text to search for.
  root                  Directory or file to scan. Defaults to current directory.

Options:
  -s, --case-sensitive  Match case exactly.
  --json                Print machine-readable JSON.
  --include-errors      Include parse/read errors in JSON output.
  --strict              Return exit code 2 when any file cannot be scanned.
  --max-snippets <n>    Snippets to print per matched file. Defaults to 5.
  --snippet-radius <n>  Characters of context around each snippet. Defaults to 48.
  -h, --help            Show this help.

Examples:
  hwp-search "contract" ~/Documents
  hwp-search "한글" ./docs --json --include-errors
  node dist/cli.js "keyword" /path/to/files
`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
