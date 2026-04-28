import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("non-embedded HTML build writes external WASM assets beside custom output", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hwp-search-build-"));
  try {
    const outputPath = join(tempDir, "nested", "hwp-search.html");
    await execFileAsync(process.execPath, [
      "scripts/build-single-html.mjs",
      "--output",
      outputPath,
    ]);

    const [html, wasmBytes, fallbackSource] = await Promise.all([
      readFile(outputPath, "utf8"),
      readFile(join(tempDir, "nested", "rhwp_bg.wasm")),
      readFile(join(tempDir, "nested", "rhwp_bg.wasm.base64.js"), "utf8"),
    ]);

    assert.match(html, /"rhwpWasmUrl":"rhwp_bg\.wasm"/);
    assert.match(html, /"rhwpWasmFallbackUrl":"rhwp_bg\.wasm\.base64\.js"/);
    assert.deepEqual([...wasmBytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
    assert.match(fallbackSource, /__HWP_SEARCH_RHWP_WASM_BASE64__/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
