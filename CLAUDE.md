# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin (TypeScript) that syncs a minimal metadata snapshot of a vault's markdown notes into a MongoDB `notes` collection. A separate Next.js knowledge-graph website reads that collection; the plugin is standalone and must not modify the website repo.

The data contract with the website — one document per markdown note, in the `notes` collection:

```ts
{ filename: string;   // vault-relative path, forward slashes, no .md extension — the graph node id / MongoDB key
  createdAt: Date;    // file creation date
  links: string[] }   // outgoing wikilinks resolved to existing markdown target filenames (same extensionless format)
```

The authoritative design spec is `docs/superpowers/specs/2026-08-13-obsidian-sync-design.md`; the implementation plan is `docs/superpowers/plans/2026-08-13-obsidian-sync.md`. Keep both in sync when behavior changes.

## Commands

```bash
npm run dev         # esbuild watch mode → main.js (inline sourcemap)
npm run build       # tsc -noEmit typecheck, then production esbuild bundle → main.js
npm test            # vitest run (all test files)
npm run test:watch  # vitest watch mode
npx vitest run tests/sync.test.ts   # run a single test file
```

- `main.js` is git-ignored and generated; never edit it by hand.
- The Obsidian plugin lifecycle and settings UI are tested manually in Obsidian — only `sync.ts`, `link-resolver.ts`, `date-util.ts`, `path-util.ts`, and `mongo.ts` have automated tests.

## Architecture

Data flow on the single manual sync command ("Sync knowledge graph to MongoDB"):

```
main.ts (plugin command)
  → runSync() in sync.ts          // orchestrator
      → buildSnapshot() in sync.ts  // pure-ish: Vault + MetadataCache → NoteSnapshot[]
          → resolveCreatedAt() in date-util.ts   // stat.ctime → stat.mtime → now
          → resolveLinks() in link-resolver.ts   // metadataCache links → resolved extensionless targets
  → mongoStore.syncNotes() in mongo.ts  // bulkWrite replaceOne upserts + deleteMany of missing
  → Notice with {inserted, updated, deleted, errors}
```

Key seams that make this testable outside Obsidian:

- **`sync.ts` is pure-ish.** `runSync(vault, metadataCache, mongoStore, settings)` and `buildSnapshot(vault, metadataCache, settings)` take Obsidian's `Vault`/`MetadataCache` interfaces and a `MongoStore`, so unit tests mock all three. It returns a `SyncResult` with an `errors: string[]` array rather than throwing — per-file failures are collected and sync continues.
- **`main.ts` owns the Mongo client lifecycle.** `getMongoStore()` creates a lazy `MongoStore` singleton keyed on `${mongoUri}|${dbName}`, closing and recreating it when settings change, on sync failure, and on `onunload()`. `sync.ts` never touches `MongoClient` directly.
- **`mongo.ts` is a thin wrapper.** `syncNotes(snapshot)` does a `bulkWrite` of `replaceOne({ filename }, note, { upsert: true })`, then `deleteMany({ filename: { $nin: snapshotFilenames } })`. The collection name is hardcoded to `notes`.
- **`types.ts` holds the shared contracts** (`NoteSnapshot`, `SyncSettings`, `SyncResult`) used by every module.

## Behavior to preserve (non-obvious)

- **Empty-snapshot safety guard.** If `buildSnapshot` finds no markdown files in the configured subdirectory, `runSync` returns an error and skips the sync — `syncNotes` is never called. This prevents an accidental wipe of the collection via `deleteMany` with an empty `$nin`.
- **Exclusive collection ownership.** The plugin deletes any `notes` documents whose `filename` isn't in the current snapshot, so it expects sole ownership of that collection. Documented in README.
- **Only resolved markdown wikilinks sync.** `resolveLinks` uses `metadataCache.getFirstLinkpathDest(link.link, file.path)`; unresolved targets and non-`.md` targets (images, PDFs, `![[embeds]]`) are dropped. Links pointing outside the configured subdirectory are kept as-is, which can create dangling edges in the graph.
- **Date resolution.** `stat.ctime` is the preferred creation time; falls back to `stat.mtime`, then current date, with verbose-mode console logging for fallbacks.

## Build constraints

`esbuild.config.mjs` must bundle the `mongodb` driver **into** `main.js` — it must NOT appear in the `external` list. This requires `platform: "node"` (externalizes Node built-ins like `net`/`tls`/`fs` so the emitted bundle can `require()` them at runtime) and `target: "es2020"` (satisfies the driver's BigInt literals). `obsidian`, `electron`, `@codemirror/*`, and `moment` are external. The manifest sets `isDesktopOnly: true`, which is why `require()`-ing Node built-ins works.

## Testing notes

- Unit tests mock Obsidian types with `as unknown as TFile`/`Vault`/`MetadataCache` casts — see the `makeFile`/`makeVault`/`makeCache` helpers in `tests/sync.test.ts` and `tests/link-resolver.test.ts`.
- `tests/mongo.test.ts` is an integration test that spins up `mongodb-memory-server` (downloads a MongoDB binary on first run) and asserts actual collection state.
