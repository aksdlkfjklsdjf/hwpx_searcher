import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { RAW_BASE_URL, RHWP_COMMIT, SAMPLES } from "./rhwp-sample-manifest.mjs";

for (const sample of SAMPLES) {
  const url = `${RAW_BASE_URL}/${encodeURI(sample.repoPath).replace(/%2F/g, "/")}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${sample.repoPath} from rhwp ${RHWP_COMMIT}: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const target = path.resolve(sample.localPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  console.log(`Fetched ${sample.repoPath} -> ${sample.localPath} (${bytes.byteLength} bytes)`);
}

