import type { MetadataCache, TFile, Vault } from "obsidian";
import { resolveCreatedAt } from "./date-util";
import { resolveLinks } from "./link-resolver";
import type { MongoStore } from "./mongo";
import { stripMarkdownExtension } from "./path-util";
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
  for (const file of files) {
    try {
      const { date: createdAt } = resolveCreatedAt(
        file.stat,
        file.path,
        settings.verbose
      );
      const links = resolveLinks(file, metadataCache);
      snapshot.push({
        filename: stripMarkdownExtension(file.path),
        createdAt,
        links,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to process ${file.path}: ${message}`);
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
