import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type StoragePathInput = {
  isPackaged: boolean;
  executablePath: string;
  moduleDir: string;
  desktopPath: string;
  environmentRoot?: string | null;
  projectRoot?: string | null;
};

export type ChaqStorageLayout = {
  root: string;
  userData: string;
  runtimeCache: string;
  diskCache: string;
  sessionData: string;
};

export function storageRootCandidates(input: StoragePathInput): string[] {
  const projectRoot = input.projectRoot?.trim() || resolve(input.moduleDir, "../../../..");
  const explicitRoot = input.environmentRoot?.trim()
    ? join(resolve(input.environmentRoot.trim()), "Chaq")
    : null;
  const relativeDefault = input.isPackaged
    ? join(dirname(resolve(input.executablePath)), ".chaq-data")
    : join(resolve(projectRoot), ".chaq-data");
  const desktopFallback = join(resolve(input.desktopPath), "Chaq");

  return [explicitRoot, relativeDefault, desktopFallback]
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index);
}

export function selectWritableStorageRoot(
  candidates: string[],
  probe: (candidate: string) => boolean = probeWritableDirectory
): string | null {
  return candidates.find((candidate) => probe(candidate)) ?? null;
}

export function createStorageLayout(root: string, runtimeCacheOverride?: string | null): ChaqStorageLayout {
  const runtimeCache = runtimeCacheOverride?.trim()
    ? resolve(runtimeCacheOverride.trim())
    : join(root, "runtime-cache-v2");
  return {
    root,
    userData: join(root, "user-data"),
    runtimeCache,
    diskCache: join(runtimeCache, "chromium"),
    sessionData: join(runtimeCache, "session-data")
  };
}

export function probeWritableDirectory(candidate: string): boolean {
  const probePath = join(candidate, `.chaq-write-probe-${process.pid}-${Date.now()}`);
  let descriptor: number | null = null;
  try {
    mkdirSync(candidate, { recursive: true });
    descriptor = openSync(probePath, "wx");
    closeSync(descriptor);
    descriptor = null;
    rmSync(probePath, { force: true });
    return true;
  } catch {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // The probe is best effort; cleanup below handles the path.
      }
    }
    try {
      rmSync(probePath, { force: true });
    } catch {
      // A failed probe must not mask the next fallback candidate.
    }
    return false;
  }
}
