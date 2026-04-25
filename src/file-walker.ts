import { opendir, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".cache",
]);

export async function* walkHwpFiles(root: string): AsyncGenerator<string> {
  const rootStats = await stat(root);

  if (rootStats.isFile()) {
    if (isHwpLikeFile(root)) {
      yield path.resolve(root);
    }
    return;
  }

  if (!rootStats.isDirectory()) {
    return;
  }

  yield* walkDirectory(path.resolve(root));
}

function isHwpLikeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLocaleLowerCase();
  return ext === ".hwp" || ext === ".hwpx";
}

async function* walkDirectory(directory: string): AsyncGenerator<string> {
  const dir = await opendir(directory);

  for await (const entry of dir) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORED_DIRS.has(entry.name)) {
        yield* walkDirectory(fullPath);
      }
      continue;
    }

    if (entry.isFile() && isHwpLikeFile(entry.name)) {
      yield fullPath;
    }
  }
}
