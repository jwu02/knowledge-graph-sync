import type { TFile } from "obsidian";

export interface DateResolution {
  date: Date;
  source: "ctime" | "mtime";
  fallback: boolean;
}

export function resolveCreatedAt(
  stat: TFile["stat"],
  filename: string,
  verbose: boolean
): DateResolution {
  const ctimeMs = stat?.ctime;
  if (typeof ctimeMs === "number" && ctimeMs > 0 && Number.isFinite(ctimeMs)) {
    return { date: new Date(ctimeMs), source: "ctime", fallback: false };
  }

  const mtimeMs = stat?.mtime;
  if (typeof mtimeMs === "number" && mtimeMs > 0 && Number.isFinite(mtimeMs)) {
    if (verbose) {
      console.log(`Using mtime for ${filename} (ctime unavailable)`);
    }
    return { date: new Date(mtimeMs), source: "mtime", fallback: true };
  }

  if (verbose) {
    console.log(`Using current date for ${filename} (ctime and mtime unavailable)`);
  }
  return { date: new Date(), source: "mtime", fallback: true };
}
