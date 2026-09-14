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
  filename: string;   // note basename, no directory or .md extension
  createdAt: Date;    // file creation date
  links: string[];    // outgoing wikilinks resolved to target basenames
}
```

- `filename` is the unique key and graph node id, e.g. `My Note` (the note basename, without directory or `.md` extension).
- `createdAt` uses Obsidian’s `TFile.stat.ctime` as the filesystem birthtime equivalent; falls back to `mtime` if `ctime` is unavailable/invalid.
- `links` contains markdown targets in the same filename format. By default only resolved, existing targets are included; enabling **Include notes that don't exist yet** also keeps unresolved targets and emits placeholder documents for them (see [Placeholder nodes](#placeholder-nodes)).

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
- Include notes that don't exist yet toggle (default off) — see [Placeholder nodes](#placeholder-nodes)
- Verbose logging toggle

Stored in Obsidian’s plugin data JSON.

### `runSync(vault, metadataCache, settings)` (sync.ts)

- Loads settings.
- Lists markdown files under the configured subdirectory.
- For each file:
  - Computes `filename` (note basename, `.md` extension stripped).
  - Computes `createdAt` from `TFile.stat` using `ctime` (birthtime equivalent) → `mtime`; logs which was used if verbose.
  - Resolves outgoing links via `metadataCache.getCache(path).links` into resolved and unresolved markdown targets.
- When **Include notes that don't exist yet** is enabled, appends unresolved targets to `links` and emits a placeholder document for each unique one whose basename no real note claims.
- Compares the computed snapshot with the existing MongoDB state:
  - Inserts new notes.
  - Updates changed notes.
  - Deletes notes no longer present in the vault.
- Returns `{ inserted, updated, deleted, errors }`.

### `MongoStore` (mongo.ts)

- Wraps `MongoClient`.
- Provides `syncNotes(snapshot: NoteSnapshot[])` using `bulkWrite`.
- Handles connection failures with a clear error message.

### `resolveTargets(file, metadataCache)` (link-resolver.ts)

- Reads `metadataCache.getCache(file.path).links || []`.
- Resolves each target via `metadataCache.getFirstLinkpathDest(link.link, file.path)`, which returns `null` for unresolved targets.
- Returns two buckets, each in document order and deduplicated by node id:
  - `resolved` — targets that exist as markdown files. Keeps only targets whose `TFile.extension` is `md`; excludes non-markdown files (e.g. images, PDFs).
  - `unresolved` — targets with no matching file that still look like notes. Because resolution returned `null`, markdown-ness is judged from the link text's basename: extensionless names (`[[Foo]]`) and explicit `.md` (`[[Foo.md]]`) qualify, while anything else (`[[diagram.png]]`, `[[v1.2]]`) is dropped from both buckets.
- Produces basenames without the `.md` extension in both buckets.

### Placeholder nodes

Controlled by the **Include notes that don't exist yet** setting (default off).

- When enabled, `buildSnapshot` extends each note's `links` with the `unresolved` bucket, so edges pointing at not-yet-written notes survive, and emits one placeholder document per unique unresolved target: `{ filename: <target>, createdAt: <sync time>, links: [] }`.
- All placeholders in a single sync share one `createdAt`, stamped once when the snapshot is built. Since documents are replaced on every sync, this is a "last seen" time rather than a first-linked time.
- A placeholder is skipped when its basename is already claimed by a real note, because `filename` is the node id.
- Targets that exist but fall outside the configured subdirectory are *resolved*, not unresolved, so they remain dangling edges and never become placeholders.
- Creating the missing note later upserts over the placeholder, since `filename` is the replacement key.
- Turning the setting off removes placeholders on the next sync, via the ordinary `deleteMany` of filenames absent from the snapshot.

## Data Flow

Normal sync (manual command):

1. User runs **“Sync knowledge graph to MongoDB”** from the command palette.
2. Plugin reads settings; if the connection string is missing, shows an error Notice and aborts.
3. Plugin opens the MongoDB client (or reuses an existing one).
4. `runSync` collects all `.md` files under the configured subdirectory using `vault.getMarkdownFiles()` and filtering by path prefix.
5. For each file:
   - `filename` = basename of `file.path` with the `.md` extension stripped.
   - `createdAt` = `stat.ctime` falling back to `stat.mtime`.
   - `links` = resolved markdown targets in the same basename format, extended with unresolved targets when **Include notes that don't exist yet** is enabled.
   - If that setting is enabled, every unresolved target whose basename no real note claims is also appended to the snapshot as a placeholder document.
6. `MongoStore.syncNotes(snapshot)` performs a bulk write:
   - `replaceOne({ filename }, note, { upsert: true })` for every snapshot entry.
   - `deleteMany({ filename: { $nin: snapshotFilenames } })` to remove stale documents.
7. Plugin shows a Notice: `Synced N notes: a added, b updated, c removed.`

### Link resolution detail

- Obsidian’s `metadataCache` resolves `[[Alias|display]]` to the canonical file path when an alias exists.
- We resolve each `link.link` (an extensionless destination, folder-relative path, or alias) through `metadataCache.getFirstLinkpathDest(link.link, file.path)`, which returns the destination `TFile` or `null` for unresolved targets. If it returns a `TFile` with `.md` extension, we include its basename, matching the `filename` node-id format.
- Embedded files (`![[...]]`) are excluded because they live in `embeds`, not `links`.
- Unresolved links to notes that do not yet exist are excluded by default. Enabling **Include notes that don't exist yet** keeps them as edges and emits placeholder nodes; see [Placeholder nodes](#placeholder-nodes).

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
- **Link resolution tests:** assert the `resolved`/`unresolved` split, node-id normalisation, deduplication by basename, and the markdown-only filter applied to unresolved link text.
- **Placeholder tests:** assert that enabling the setting keeps unresolved edges and emits one placeholder per unique target, that basenames claimed by real notes are skipped, and that disabling it changes nothing.
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
| Unresolved targets | Exclude by default; opt-in placeholder nodes | The default keeps the graph to real notes; the toggle lets notes you have referenced but not written appear as placeholder nodes. |
| Node id format | Note basename (no directory, no `.md`) | Matches the note names shown in Obsidian; same-named notes in different folders produce the same id and collide |
| MongoDB approach | Bundle Node.js driver | Single artifact; direct contract match; simplest operation. |

## Open Questions

None — all architectural and behavioral questions have been resolved and are recorded above.
