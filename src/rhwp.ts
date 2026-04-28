import init, { HwpDocument } from "@rhwp/core";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

let initPromise: Promise<unknown> | undefined;

export async function initializeRhwp(): Promise<void> {
  if (!initPromise) {
    installTextMeasurementFallback();
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@rhwp/core/rhwp_bg.wasm");
    initPromise = readFile(wasmPath).then((wasm) => init({ module_or_path: wasm }));
  }

  await initPromise;
}

export async function loadHwpDocument(filePath: string): Promise<HwpDocument> {
  await initializeRhwp();
  const data = new Uint8Array(await readFile(filePath));

  try {
    return new HwpDocument(data);
  } catch (error) {
    throw normalizeRhwpDecodeError(error);
  }
}

function normalizeRhwpDecodeError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  if (/invalid\s+utf-?16\s*:\s*lone surrogate found/i.test(error.message)) {
    return new Error(`DocInfo UTF-16 decoding failure: ${error.message}`);
  }

  return error;
}

function installTextMeasurementFallback(): void {
  const target = globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number;
  };

  if (typeof target.measureTextWidth === "function") {
    return;
  }

  target.measureTextWidth = (font: string, text: string): number => {
    const fontSize = extractPixelSize(font) ?? 12;
    let width = 0;

    for (const char of text) {
      if (char === "\t") {
        width += fontSize * 2;
      } else if (char === " ") {
        width += fontSize * 0.35;
      } else if (isWideCharacter(char)) {
        width += fontSize * 0.95;
      } else {
        width += fontSize * 0.55;
      }
    }

    return width;
  };
}

function extractPixelSize(font: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : undefined;
}

function isWideCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}
