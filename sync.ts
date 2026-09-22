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

/** The note that supplied an unresolved target's date, and the date it supplied. */
interface PlaceholderSource {
  createdAt: Date;
  /** Linking note basename — names the winner in verbose logs. */
  linker: string;
}

/** Should `candidate` dethrone the `incumbent` as the target's date source? */
function supersedes(
  candidate: PlaceholderSource,
  incumbent: PlaceholderSource
): boolean {
  const delta = candidate.createdAt.getTime() - incumbent.createdAt.getTime();
  // Ties break on the linker's name so the winner never depends on vault order.
  return delta < 0 || (delta === 0 && candidate.linker < incumbent.linker);
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
  const placeholderSources = new Map<string, PlaceholderSource>();

  for (const file of files) {
    try {
      const { date: createdAt } = resolveCreatedAt(
        file.stat,
        file.path,
        settings.verbose
      );
      const { resolved, unresolved } = resolveTargets(file, metadataCache);
      const filename = basenameWithoutExtension(file.path);
      if (settings.includeUnresolved) {
        for (const target of unresolved) {
          // A placeholder inherits its linker's resolved date as-is, so one
          // date-resolution rule covers both real notes and placeholders.
          const candidate = { createdAt, linker: filename };
          const incumbent = placeholderSources.get(target);
          if (!incumbent || supersedes(candidate, incumbent)) {
            placeholderSources.set(target, candidate);
          }
        }
      }
      snapshot.push({
        filename,
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

  if (placeholderSources.size > 0) {
    const claimed = new Set(snapshot.map((note) => note.filename));
    for (const [target, source] of placeholderSources) {
      // A real note always wins the basename, since filename is the node id.
      if (claimed.has(target)) {
        continue;
      }
      claimed.add(target);
      if (settings.verbose) {
        console.log(`Dating placeholder ${target} from ${source.linker}`);
      }
      snapshot.push({
        filename: target,
        createdAt: source.createdAt,
        links: [],
      });
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
