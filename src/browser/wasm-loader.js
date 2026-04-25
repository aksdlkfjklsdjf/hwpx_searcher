const WasmLoader = (() => {
  const fallbackGlobal = "__HWP_SEARCH_RHWP_WASM_BASE64__";

  async function loadRhwpWasmBytes(payload) {
    let primaryError = null;

    if (payload.rhwpWasmUrl) {
      try {
        const response = await fetch(new URL(payload.rhwpWasmUrl, document.baseURI));
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " while loading " + payload.rhwpWasmUrl);
        }
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          source: "wasm-file",
        };
      } catch (error) {
        primaryError = error;
      }
    }

    if (payload.rhwpWasmFallbackUrl) {
      try {
        await loadScript(new URL(payload.rhwpWasmFallbackUrl, document.baseURI).href);
        const base64 = globalThis[fallbackGlobal];
        if (typeof base64 !== "string" || base64.length === 0) {
          throw new Error("WASM fallback script did not expose " + fallbackGlobal);
        }
        return {
          bytes: base64ToBytes(base64),
          source: "wasm-fallback-script",
        };
      } catch (fallbackError) {
        throw new Error("Could not load rhwp WASM. Primary: " + errorMessage(primaryError) + ". Fallback: " + errorMessage(fallbackError));
      }
    }

    if (payload.rhwpWasmBase64) {
      return {
        bytes: base64ToBytes(payload.rhwpWasmBase64),
        source: "embedded-base64",
      };
    }

    throw new Error("Missing rhwp WASM asset configuration" + (primaryError ? ": " + errorMessage(primaryError) : ""));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => reject(new Error("Failed to load " + src)));
      document.head.append(script);
    });
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error ?? "none");
  }

  return { loadRhwpWasmBytes };
})();
