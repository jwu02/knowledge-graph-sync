import type { MetadataCache, TFile } from "obsidian";
import { basenameWithoutExtension } from "./path-util";

export interface ResolvedTargets {
  /** Targets that exist as markdown files, in document order. */
  resolved: string[];
  /** Markdown-looking targets with no matching file, in document order. */
  unresolved: string[];
}

// Unresolved links give us only the raw link text, so markdown-ness is judged
// from its basename: extensionless names and explicit .md both denote notes,
// while anything else (diagram.png, v1.2) is treated as a non-note target.
function looksLikeMarkdownNote(linkText: string): boolean {
  const basename = linkText.split("/").pop() ?? linkText;
  return basename.endsWith(".md") || !basename.includes(".");
}

export function resolveTargets(
  file: TFile,
  metadataCache: MetadataCache
): ResolvedTargets {
  const cache = metadataCache.getCache(file.path);
  if (!cache?.links) {
    return { resolved: [], unresolved: [] };
  }

  const resolved: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const link of cache.links) {
    // Resolves extensionless basenames, folder-relative paths, and aliases
    // to the destination TFile; returns null when the target does not exist.
    const target = metadataCache.getFirstLinkpathDest(link.link, file.path);
    const isMarkdown = target
      ? target.extension === "md"
      : looksLikeMarkdownNote(link.link);
    if (!isMarkdown) {
      continue;
    }

    // Node ids are basenames, so distinct paths sharing a basename collapse here.
    const nodeId = basenameWithoutExtension(target ? target.path : link.link);
    if (seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);

    (target ? resolved : unresolved).push(nodeId);
  }

  return { resolved, unresolved };
}
