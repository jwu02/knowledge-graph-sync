import type { MetadataCache, TFile, Vault } from "obsidian";

export function resolveLinks(
  file: TFile,
  metadataCache: MetadataCache,
  vault: Vault
): string[] {
  const cache = metadataCache.getCache(file.path);
  if (!cache?.links) {
    return [];
  }

  const result: string[] = [];
  for (const link of cache.links) {
    const target = vault.getAbstractFileByPath(link.link);
    // TFile is a type-only import (obsidian ships no runtime exports), so
    // `instanceof TFile` would throw ReferenceError. Use a structural check:
    // a markdown file has an `extension` property equal to "md".
    if (target && "extension" in target && target.extension === "md") {
      result.push(target.path);
    }
  }
  return result;
}
