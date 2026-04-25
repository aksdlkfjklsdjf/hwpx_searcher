const SearchWorkerClient = (() => {
  function create({ workerUrl, rhwpJs, rhwpWasmBytes }) {
    const worker = new Worker(workerUrl);
    let nextMessageId = 0;
    const pending = new Map();

    const ready = new Promise((resolve, reject) => {
      pending.set(0, { resolve, reject });
    });

    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "ready") {
        pending.get(0)?.resolve();
        pending.delete(0);
        return;
      }
      if (message.type === "init-error") {
        pending.get(0)?.reject(new Error(message.error || "Worker initialization failed"));
        pending.delete(0);
        return;
      }

      const callbacks = pending.get(message.id);
      if (!callbacks) {
        return;
      }
      pending.delete(message.id);
      if (message.type === "error") {
        callbacks.reject(new Error(message.error || "Worker task failed"));
      } else {
        callbacks.resolve(message.result);
      }
    });

    worker.addEventListener("error", (event) => {
      const detail = [
        event.message || "Worker error",
        event.filename,
        event.lineno ? "line " + event.lineno : "",
        event.colno ? "column " + event.colno : "",
      ].filter(Boolean).join(" · ");
      for (const callbacks of pending.values()) {
        callbacks.reject(new Error(detail));
      }
      pending.clear();
    });

    worker.postMessage({
      type: "init",
      rhwpJs,
      rhwpWasmBytes,
    });

    return {
      ready,
      search(task, transfer) {
        const id = ++nextMessageId;
        worker.postMessage({ type: "search", id, task }, transfer);
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
        });
      },
      terminate() {
        worker.terminate();
      },
    };
  }

  return { create };
})();
