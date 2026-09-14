import type { MetadataCache, TFile, Vault } from "obsidian";
import { resolveCreatedAt } from "./date-util";
import { resolveTargets } from "./link-resolver";
import type { MongoStore } from "./mongo";
import { basenameWithoutExtension } from "./path-util";
import type { NoteSnapshot, SyncResult, SyncSettings } from "./types";

function normalizeSubdir(subdir: string): string {
  return subdir.replace(/\\/g, "/").replace(/\/$/, "");
}

function isUnderSubdir(path: string, subdir: string): boolean {
  if (!subdir) return true;
  const normalized = normalizeSubdir(subdir);
  return path === normalized || path.startsWith(normalized + "/");
}

export function buildSnapshot(
  vault: Vault,
  metadataCache: MetadataCache,
  settings: SyncSettings
): { snapshot: NoteSnapshot[]; errors: string[] } {
  const errors: string[] = [];
  const files = vault.getMarkdownFiles().filter((file) =>
    isUnderSubdir(file.path, settings.subdir)
  );

  const snapshot: NoteSnapshot[] = [];
  const unresolvedTargets = new Set<string>();

  for (const file of files) {
    try {
      const { date: createdAt } = resolveCreatedAt(
        file.stat,
        file.path,
        settings.verbose
      );
      const { resolved, unresolved } = resolveTargets(file, metadataCache);
      if (settings.includeUnresolved) {
        for (const target of unresolved) {
          unresolvedTargets.add(target);
        }
      }
      snapshot.push({
        filename: basenameWithoutExtension(file.path),
        createdAt,
        links: settings.includeUnresolved
          ? [...resolved, ...unresolved]
          : resolved,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to process ${file.path}: ${message}`);
    }
  }

  if (unresolvedTargets.size > 0) {
    const claimed = new Set(snapshot.map((note) => note.filename));
    const createdAt = new Date();
    for (const target of unresolvedTargets) {
      // A real note always wins the basename, since filename is the node id.
      if (claimed.has(target)) {
        continue;
      }
      claimed.add(target);
      snapshot.push({ filename: target, createdAt, links: [] });
    }
  }

  return { snapshot, errors };
}

export async function runSync(
  vault: Vault,
  metadataCache: MetadataCache,
  mongoStore: MongoStore,
  settings: SyncSettings
): Promise<SyncResult> {
  if (!settings.mongoUri) {
    return { inserted: 0, updated: 0, deleted: 0, errors: ["MongoDB URI is not configured"] };
  }

  const { snapshot, errors } = buildSnapshot(vault, metadataCache, settings);

  if (snapshot.length === 0) {
    return {
      inserted: 0,
      updated: 0,
      deleted: 0,
      errors: [...errors, "No markdown notes found in the configured subdirectory"],
    };
  }

  try {
    const { inserted, updated, deleted } = await mongoStore.syncNotes(snapshot);
    return { inserted, updated, deleted, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { inserted: 0, updated: 0, deleted: 0, errors: [...errors, message] };
  }
}
