export const RHWP_REPO = "https://github.com/edwardkim/rhwp";
export const RHWP_COMMIT = "bea635bd708274a51ae3f557a71b07683d7c2454";
export const RAW_BASE_URL = `https://raw.githubusercontent.com/edwardkim/rhwp/${RHWP_COMMIT}`;

export const SAMPLES = [
  {
    name: "lseg-01-basic.hwp",
    label: "HWP line segment sample",
    format: "HWP",
    repoPath: "samples/lseg-01-basic.hwp",
    localPath: "samples/rhwp/lseg-01-basic.hwp",
    searchHint: "라인",
  },
  {
    name: "ref_text.hwpx",
    label: "HWPX reference text sample",
    format: "HWPX",
    repoPath: "samples/hwpx/ref/ref_text.hwpx",
    localPath: "samples/rhwp/ref_text.hwpx",
    searchHint: "Hello",
  },
];

