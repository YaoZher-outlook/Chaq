import { open } from "node:fs/promises";

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
// Base64 expands data by roughly 4/3. Keeping the source below 5.5 MiB
// leaves room for the data URL prefix and the server's 8,000,000-char limit.
export const MAX_IMAGE_FILE_BYTES = Math.floor(5.5 * 1024 * 1024);

export async function readFileWithLimit(
  filePath: string,
  maximumBytes: number,
  label: string
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error("文件大小限制配置无效。");
  }

  const handle = await open(filePath, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error(`${label}不是可读取的普通文件。`);
    }
    if (metadata.size > maximumBytes) {
      throw fileTooLargeError(label, maximumBytes);
    }

    const bytes = await handle.readFile();
    // Check again after reading in case the file grew between stat and read.
    if (bytes.byteLength > maximumBytes) {
      throw fileTooLargeError(label, maximumBytes);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function fileTooLargeError(label: string, maximumBytes: number): Error {
  if (maximumBytes < 1024) {
    return new Error(`${label}过大，请选择不超过 ${maximumBytes} 字节的文件。`);
  }
  if (maximumBytes < 1024 * 1024) {
    const maximumKiB = maximumBytes / 1024;
    const displayLimit = Number.isInteger(maximumKiB) ? String(maximumKiB) : maximumKiB.toFixed(1);
    return new Error(`${label}过大，请选择不超过 ${displayLimit} KiB 的文件。`);
  }
  const maximumMiB = maximumBytes / (1024 * 1024);
  const displayLimit = Number.isInteger(maximumMiB) ? String(maximumMiB) : maximumMiB.toFixed(1);
  return new Error(`${label}过大，请选择不超过 ${displayLimit} MiB 的文件。`);
}
