import type { MetadataCache, TFile } from "obsidian";

export function resolveLinks(
  file: TFile,
  metadataCache: MetadataCache
): string[] {
  const cache = metadataCache.getCache(file.path);
  if (!cache?.links) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const link of cache.links) {
    // Resolves extensionless basenames, folder-relative paths, and aliases
    // to the destination TFile; returns null when the target does not exist.
    const target = metadataCache.getFirstLinkpathDest(link.link, file.path);
    if (target && target.extension === "md" && !seen.has(target.path)) {
      seen.add(target.path);
      result.push(target.path);
    }
  }
  return result;
}
