const BrowserFileStore = (() => {
  const dbNamePrefix = "hwp-recursive-search";
  let dbName = dbNamePrefix;
  const storeName = "files";
  const batchSize = 100;

  async function replaceFiles(records) {
    const db = await openDb();
    try {
      await clearStore(db);
      const stored = [];

      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        const storedBatch = [];
        for (const record of batch) {
          storedBatch.push({
            id: record.id,
            name: record.name,
            label: record.label,
            format: record.format,
            path: record.path,
            repoPath: record.repoPath,
            source: record.source,
            size: record.size,
            lastModified: record.lastModified,
            blob: await fileRecordBlob(record.file),
          });
        }

        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        for (const storedRecord of storedBatch) {
          store.put(storedRecord);
          stored.push(stripBlob(storedRecord));
        }
        await transactionDone(tx);
        await yieldToBrowser();
      }

      return stored;
    } finally {
      db.close();
    }
  }

  async function getBytes(id) {
    const db = await openDb();
    try {
      const record = await requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(id));
      if (!record?.blob) {
        throw new Error("File is not available in browser database: " + id);
      }
      return new Uint8Array(await record.blob.arrayBuffer());
    } finally {
      db.close();
    }
  }

  async function count() {
    const db = await openDb();
    try {
      return await requestResult(db.transaction(storeName, "readonly").objectStore(storeName).count());
    } finally {
      db.close();
    }
  }

  async function clear() {
    const db = await openDb();
    try {
      await clearStore(db);
    } finally {
      db.close();
    }
  }

  function isSupported() {
    return typeof indexedDB !== "undefined" && typeof Blob !== "undefined";
  }


  function setNamespace(namespace) {
    const normalized = normalizeNamespace(namespace);
    dbName = normalized ? `${dbNamePrefix}:${normalized}` : dbNamePrefix;
  }

  function normalizeNamespace(namespace) {
    if (typeof namespace !== "string") {
      return "";
    }
    return namespace.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  function openDb() {
    if (!isSupported()) {
      return Promise.reject(new Error("IndexedDB is not available"));
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error || new Error("Could not open IndexedDB")));
    });
  }

  function clearStore(db) {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    return transactionDone(tx);
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("abort", () => reject(tx.error || new Error("IndexedDB transaction aborted")));
      tx.addEventListener("error", () => reject(tx.error || new Error("IndexedDB transaction failed")));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed")));
    });
  }

  async function fileRecordBlob(file) {
    if (file instanceof Blob) {
      return file;
    }
    if (file?.blob instanceof Blob) {
      return file.blob;
    }
    return new Blob([await file.arrayBuffer()]);
  }

  function stripBlob(record) {
    const { blob: _blob, ...metadata } = record;
    return metadata;
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    clear,
    count,
    getBytes,
    isSupported,
    replaceFiles,
    setNamespace,
  };
})();
