# Obsidian Knowledge Graph Sync Plugin — Design

**Date:** 2026-08-13  
**Status:** Approved  
**Approach:** Bundle the MongoDB Node.js driver inside a standard Obsidian plugin.

## Goal

Build an Obsidian plugin that syncs a minimal metadata snapshot of a vault subdirectory into a MongoDB collection named `notes`. A separate Next.js website reads that collection to render an Obsidian-style knowledge graph. The plugin is a standalone tool and does not modify the website.

## Contract with the Website

The website expects the `notes` collection (database: `env.ACTIVITY_DB_NAME`, default `activity-telemetry`) to contain one document per markdown note:

```ts
{
  filename: string;   // vault-relative path with forward slashes, no .md extension
  createdAt: Date;    // file creation date
  links: string[];    // outgoing wikilinks resolved to target filenames
}
```

- `filename` is the unique key and graph node id, e.g. `Projects/My Note` (the vault-relative path with the `.md` extension stripped).
- `createdAt` uses Obsidian’s `TFile.stat.ctime` as the filesystem birthtime equivalent; falls back to `mtime` if `ctime` is unavailable/invalid.
- `links` contains only resolved, existing markdown targets in the same filename format.

## Architecture

The plugin is a standard Obsidian plugin with one additional responsibility: pushing a graph snapshot to MongoDB.

```
knowledge-graph-sync/
├── manifest.json          # Obsidian plugin metadata
├── package.json           # deps: obsidian, mongodb, esbuild, typescript
├── esbuild.config.mjs     # bundle main.ts + MongoDB driver
├── main.ts                # Plugin class, command, settings tab
├── settings.ts            # Settings schema + defaults
├── sync.ts                # Sync engine: scan → resolve → bulk write
├── mongo.ts               # MongoDB client wrapper
├── link-resolver.ts       # Transform metadataCache links → target filenames
└── README.md
```

Key design choices:

- `sync.ts` is pure-ish: it receives `Vault` and `MetadataCache` abstractions plus a MongoDB collection, so it can be unit-tested outside Obsidian.
- The MongoDB client is created lazily on first sync and reused for the Obsidian session.
- All filesystem dates come from Obsidian’s `TFile.stat`, trying `ctime` (Obsidian’s creation/birthtime equivalent) → `mtime`.

## Components

### `KnowledgeGraphSyncPlugin` (main.ts)

- Registers the command palette item **“Sync knowledge graph to MongoDB”**.
- Registers a settings tab.
- Holds the MongoDB client singleton.
- On command: calls `runSync()` and shows a Notice with the result.

### `Settings` / `KnowledgeGraphSyncSettingTab` (settings.ts)

Settings fields:

- MongoDB connection string
- Database name (default: `activity-telemetry`, mirroring `ACTIVITY_DB_NAME`)
- Vault subdirectory to scan (e.g. `Projects`; empty = whole vault)
- Verbose logging toggle

Stored in Obsidian’s plugin data JSON.

### `runSync(vault, metadataCache, settings)` (sync.ts)

- Loads settings.
- Lists markdown files under the configured subdirectory.
- For each file:
  - Computes `filename` (vault-relative, forward slashes, `.md` extension stripped).
  - Computes `createdAt` from `TFile.stat` using `ctime` (birthtime equivalent) → `mtime`; logs which was used if verbose.
  - Resolves outgoing links via `metadataCache.getCache(path).links`, keeping only those whose target exists in the vault and is a markdown file.
- Compares the computed snapshot with the existing MongoDB state:
  - Inserts new notes.
  - Updates changed notes.
  - Deletes notes no longer present in the vault.
- Returns `{ inserted, updated, deleted, errors }`.

### `MongoStore` (mongo.ts)

- Wraps `MongoClient`.
- Provides `syncNotes(snapshot: NoteSnapshot[])` using `bulkWrite`.
- Handles connection failures with a clear error message.

### `resolveLinks(file, metadataCache)` (link-resolver.ts)

- Reads `metadataCache.getCache(file.path).links || []`.
- Resolves each target via `metadataCache.getFirstLinkpathDest(link.link, file.path)`, which returns `null` for unresolved targets.
- Keeps only resolved targets whose `TFile.extension` is `md`; excludes non-markdown targets (e.g. images, PDFs).
- Produces vault-relative filenames without the `.md` extension.

## Data Flow

Normal sync (manual command):

1. User runs **“Sync knowledge graph to MongoDB”** from the command palette.
2. Plugin reads settings; if the connection string is missing, shows an error Notice and aborts.
3. Plugin opens the MongoDB client (or reuses an existing one).
4. `runSync` collects all `.md` files under the configured subdirectory using `vault.getMarkdownFiles()` and filtering by path prefix.
5. For each file:
   - `filename` = `file.path` with the `.md` extension stripped.
   - `createdAt` = `stat.ctime` falling back to `stat.mtime`.
   - `links` = resolved, existing-markdown targets in the same extensionless format.
6. `MongoStore.syncNotes(snapshot)` performs a bulk write:
   - `replaceOne({ filename }, note, { upsert: true })` for every snapshot entry.
   - `deleteMany({ filename: { $nin: snapshotFilenames } })` to remove stale documents.
7. Plugin shows a Notice: `Synced N notes: a added, b updated, c removed.`

### Link resolution detail

- Obsidian’s `metadataCache` resolves `[[Alias|display]]` to the canonical file path when an alias exists.
- We resolve each `link.link` (an extensionless destination, folder-relative path, or alias) through `metadataCache.getFirstLinkpathDest(link.link, file.path)`, which returns the destination `TFile` or `null` for unresolved targets. If it returns a `TFile` with `.md` extension, we include its path with the extension stripped, matching the `filename` node-id format.
- Embedded files (`![[...]]`) are excluded because they live in `embeds`, not `links`.
- Unresolved links to notes that do not yet exist are excluded.

### Date fallback detail

- Obsidian’s `TFile.stat` exposes `ctime` (creation time) and `mtime` (modification time). There is no separate `birthtime` field.
- Use `stat.ctime` as the birthtime equivalent; if it is missing or invalid, fall back to `stat.mtime`.
- In verbose mode, log: `Using mtime for Projects/Foo.md (ctime unavailable)`.

## Error Handling

- **Missing settings:** If the MongoDB URI is empty, abort early with a Notice.
- **Connection failure:** Catch `MongoServerError` / network errors; show a Notice and close the client so the next sync retries a fresh connection.
- **Malformed notes:** A single unreadable file is skipped and counted in `errors`; sync continues for the rest.
- **Stale client:** If a sync fails mid-run, the client is discarded; the next command creates a new one.
- **No notes found:** Show a warning Notice. For safety, when the filtered file list is empty the delete step is skipped to avoid wiping the collection accidentally.

## Testing

Because `sync.ts` accepts `Vault` and `MetadataCache` interfaces, it can be unit-tested with mocks:

- **Snapshot generation tests:** mock `Vault` and `MetadataCache` with a few files and links; assert the resulting `NoteSnapshot[]` has correct `filename`, `createdAt`, and resolved `links`.
- **Date fallback tests:** simulate `TFile.stat` objects with missing or invalid `ctime`.
- **MongoDB integration test:** spin up `mongodb-memory-server`, call `syncNotes`, assert collection state.

The Obsidian plugin lifecycle and settings UI will be tested manually in Obsidian.

## Decisions Made

| Decision | Choice | Rationale |
| --- | --- | --- |
| Plugin form | Obsidian plugin running inside Obsidian | Direct integration with vault and metadata cache. |
| Sync trigger | Manual command only | Simplest and most predictable for a first version. |
| Deleted notes | Delete from MongoDB | Keeps MongoDB an exact mirror of the vault subset. |
| Link syntax | Wikilinks only via Obsidian metadata cache | Obsidian handles parsing, alias resolution, and path resolution. |
| Alias resolution | Use Obsidian’s resolved cache | More robust than custom parsing. |
| Unresolved targets | Exclude | Avoid creating graph nodes for notes that do not exist yet. |
| MongoDB approach | Bundle Node.js driver | Single artifact; direct contract match; simplest operation. |

## Open Questions

None — all architectural and behavioral questions have been resolved and are recorded above.
