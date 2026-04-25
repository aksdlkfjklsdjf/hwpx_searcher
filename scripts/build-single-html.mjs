import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const browserDir = path.join(rootDir, "src/browser");
const outputPath = path.join(rootDir, "hwp-search.html");
const wasmFileName = "rhwp_bg.wasm";
const wasmFallbackFileName = "rhwp_bg.wasm.base64.js";
const wasmOutputPath = path.join(rootDir, wasmFileName);
const wasmFallbackOutputPath = path.join(rootDir, wasmFallbackFileName);

const [rhwpJs, rhwpWasm, themeBootstrapJs, css, bodyHtml] = await Promise.all([
  readFile(require.resolve("@rhwp/core/rhwp.js"), "utf8"),
  readFile(require.resolve("@rhwp/core/rhwp_bg.wasm")),
  readFile(path.join(browserDir, "theme-bootstrap.js"), "utf8"),
  readFile(path.join(browserDir, "hwp-search.css"), "utf8"),
  readFile(path.join(browserDir, "app-body.html"), "utf8"),
]);
const appJs = await readBrowserBundle(["i18n.js", "search-core.js", "wasm-loader.js", "worker-client.js", "file-index.js", "results-view.js", "preview-view.js", "app.js"]);
const workerJs = await readBrowserBundle(["search-core.js", "search-worker.js"]);

const html = renderHtml({
  payload: {
    rhwpJs,
    rhwpWasmUrl: wasmFileName,
    rhwpWasmFallbackUrl: wasmFallbackFileName,
    workerJs,
  },
  themeBootstrapJs,
  css,
  bodyHtml,
  appJs,
});
const wasmFallbackJs = renderWasmFallbackScript(rhwpWasm);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, html);
await writeFile(wasmOutputPath, rhwpWasm);
await writeFile(wasmFallbackOutputPath, wasmFallbackJs);
console.log(`Wrote ${outputPath} (${Buffer.byteLength(html)} bytes)`);
console.log(`Wrote ${wasmOutputPath} (${rhwpWasm.byteLength} bytes)`);
console.log(`Wrote ${wasmFallbackOutputPath} (${Buffer.byteLength(wasmFallbackJs)} bytes)`);

function renderHtml({ payload, themeBootstrapJs, css, bodyHtml, appJs }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HWP Search</title>
  <script>
${indent(themeBootstrapJs.trim(), 4)}
  </script>
  <style>
${indent(css.trim(), 4)}
  </style>
</head>
<body>
${indent(bodyHtml.trim(), 2)}
  <script id="payload" type="application/json">${escapeJsonForScript(JSON.stringify(payload))}</script>
  <script type="module">
${indent(appJs.trim(), 4)}
  </script>
</body>
</html>
`;
}

async function readBrowserBundle(files) {
  const sources = await Promise.all(files.map((file) => readFile(path.join(browserDir, file), "utf8")));
  return sources.map((source, index) => `// ${files[index]}\n${source.trim()}`).join("\n\n");
}

function indent(value, spaces) {
  const padding = " ".repeat(spaces);
  return value.split("\n").map((line) => line ? padding + line : line).join("\n");
}

function escapeJsonForScript(value) {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderWasmFallbackScript(wasm) {
  return `globalThis.__HWP_SEARCH_RHWP_WASM_BASE64__ = "${wasm.toString("base64")}";\n`;
}
