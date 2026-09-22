# Obsidian Knowledge Graph Sync Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Obsidian plugin that syncs a minimal metadata snapshot of a configured vault subdirectory into a MongoDB `notes` collection for a separate Next.js knowledge-graph website.

**Architecture:** A standard Obsidian plugin written in TypeScript. The sync engine is split into a pure snapshot builder (`sync.ts`) that consumes Obsidian’s `Vault` and `MetadataCache` abstractions, and a small MongoDB wrapper (`mongo.ts`) that applies the snapshot with `bulkWrite`. The plugin registers one command that orchestrates the two.

**Tech Stack:** TypeScript 5.x, Obsidian API, `mongodb` Node driver, esbuild, Vitest, `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-08-13-obsidian-sync-design.md`

> **Amendment (2026-09-22):** Placeholder nodes no longer carry the sync time. Each placeholder's `createdAt` is now the earliest resolved creation date among the snapshot notes that link to it, inherited verbatim from the winning linker (`buildSnapshot` stamps no timestamp of its own; the only remaining clock read is `resolveCreatedAt`'s `new Date()` last resort for a file with no usable stat). See [ADR-0002](../../adr/0002-placeholder-dates-are-derived.md) and the spec's [Placeholder nodes](../../specs/2026-08-13-obsidian-sync-design.md#placeholder-nodes) section.

> **Amendment (2026-09-13):** An **Include notes that don't exist yet** setting was added after this plan was executed. It inverts the original "exclude unresolved targets" decision behind an opt-in toggle: `resolveLinks` became `resolveTargets` (returning `resolved` and `unresolved` buckets), and `buildSnapshot` keeps unresolved edges and emits placeholder documents when the setting is on. The code listings below remain as executed and are superseded by the spec's [Placeholder nodes](../../specs/2026-08-13-obsidian-sync-design.md#placeholder-nodes) section; the constraints and self-review entries in this document have been updated to match current behaviour.

## Global Constraints

- One document per markdown note in the MongoDB `notes` collection.
- Document shape: `{ filename: string; createdAt: Date; links: string[] }`.
- `filename` is the note basename without directory or `.md` extension, e.g. `My Note`.
- `createdAt` uses `TFile.stat.ctime` as the birthtime equivalent; falls back to `stat.mtime` if `ctime` is unavailable/invalid.
- `links` are markdown targets in the same filename format; non-markdown targets are always excluded. Unresolved targets are excluded by default and included when **Include notes that don't exist yet** is enabled, which also emits placeholder documents for them. A placeholder's `createdAt` is derived from its earliest linking note rather than stamped at sync time.
- Sync is triggered by a single manual Obsidian command.
- Deleted vault notes are deleted from MongoDB on the next sync, unless the scanned file list is empty (safety guard).
- Plugin does not modify the website repo.
- MongoDB connection string, database name, vault subdirectory, verbose logging, and the include-notes-that-don't-exist-yet toggle are configurable via Obsidian settings.

---

## File Structure

```
knowledge-graph-sync/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── versions.json
├── main.ts                 # Plugin entry point
├── settings.ts             # Settings schema + settings tab
├── sync.ts                 # Snapshot builder + runSync orchestrator
├── mongo.ts                # MongoDB client wrapper
├── link-resolver.ts        # Obsidian metadataCache → link filenames
├── path-util.ts            # filename/extension helpers
├── date-util.ts            # ctime/mtime fallback helper
├── env-config.ts           # .env parsing + settings precedence (Task 8)
├── types.ts                # Shared TypeScript interfaces
├── .env.example            # Committed template for the ignored .env
├── README.md
└── tests/
    ├── sync.test.ts
    ├── link-resolver.test.ts
    ├── mongo.test.ts
    ├── env-config.test.ts
    └── date-util.test.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `manifest.json`
- Create: `versions.json`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable Obsidian plugin skeleton.

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "id": "knowledge-graph-sync",
  "name": "Knowledge Graph Sync",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "Sync a minimal note metadata snapshot to MongoDB for an external knowledge graph.",
  "author": "",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: Create `versions.json`**

```json
{
  "1.0.0": "0.15.0"
}
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "obsidian-knowledge-graph-sync",
  "version": "1.0.0",
  "description": "Obsidian plugin that syncs note metadata to MongoDB",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": [
    "obsidian",
    "plugin",
    "mongodb",
    "knowledge-graph"
  ],
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.14.0",
    "esbuild": "^0.21.4",
    "obsidian": "latest",
    "tslib": "^2.6.3",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "mongodb": "^6.7.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": [
      "DOM",
      "ES6"
    ]
  },
  "include": [
    "**/*.ts"
  ]
}
```

- [ ] **Step 5: Create `esbuild.config.mjs`**

```js
import esbuild from "esbuild";
import process from "process";

const prod = (process.argv[2] === "production");

const context = await esbuild.context({
  banner: {
    js: "",
  },
  entryPoints: ["main.ts"],
  bundle: true,
  platform: "node",
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "moment",
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

- [ ] **Step 6: Create a minimal `README.md`**

```markdown
# Knowledge Graph Sync

Obsidian plugin that syncs a minimal metadata snapshot of your vault to a MongoDB `notes` collection.

## Usage

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Copy `manifest.json`, `main.js`, and `versions.json` to your vault’s `.obsidian/plugins/knowledge-graph-sync/` folder.
4. Open Obsidian settings, configure the MongoDB connection string and database name, then run **"Sync knowledge graph to MongoDB"** from the command palette.
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Verify dev build**

Run: `npm run dev`

Wait for esbuild to finish the initial bundle, then press Ctrl+C.

Expected: `main.js` created.

- [ ] **Step 9: Commit**

```bash
git add manifest.json versions.json package.json tsconfig.json esbuild.config.mjs README.md
git commit -m "chore: scaffold obsidian plugin project"
```

---

### Task 2: Shared Types and Settings

**Files:**
- Create: `types.ts`
- Create: `settings.ts`
- Create: `main.ts` (initial version)

**Interfaces:**
- Consumes: nothing.
- Produces: `NoteSnapshot`, `SyncSettings`, `SyncResult`, `DEFAULT_SETTINGS`, `KnowledgeGraphSyncSettingTab`, `KnowledgeGraphSyncPlugin`.

- [ ] **Step 1: Create `types.ts`**

```ts
export interface NoteSnapshot {
  filename: string;
  createdAt: Date;
  links: string[];
}

export interface SyncSettings {
  mongoUri: string;
  dbName: string;
  subdir: string;
  verbose: boolean;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  errors: string[];
}
```

- [ ] **Step 2: Create `settings.ts`**

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type { SyncSettings } from "./types";
import KnowledgeGraphSyncPlugin from "./main";

export const DEFAULT_SETTINGS: SyncSettings = {
  mongoUri: "",
  dbName: "activity-telemetry",
  subdir: "",
  verbose: false,
};

export class KnowledgeGraphSyncSettingTab extends PluginSettingTab {
  plugin: KnowledgeGraphSyncPlugin;

  constructor(app: App, plugin: KnowledgeGraphSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("MongoDB connection string")
      .setDesc("URI used to connect to MongoDB.")
      .addText((text) =>
        text
          .setPlaceholder("mongodb://localhost:27017")
          .setValue(this.plugin.settings.mongoUri)
          .onChange(async (value) => {
            this.plugin.settings.mongoUri = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Database name")
      .setDesc("Database containing the 'notes' collection. Defaults to activity-telemetry.")
      .addText((text) =>
        text
          .setPlaceholder("activity-telemetry")
          .setValue(this.plugin.settings.dbName)
          .onChange(async (value) => {
            this.plugin.settings.dbName = value || DEFAULT_SETTINGS.dbName;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Vault subdirectory")
      .setDesc("Only sync notes under this path, e.g. Projects. Leave empty to sync the whole vault.")
      .addText((text) =>
        text
          .setPlaceholder("Projects")
          .setValue(this.plugin.settings.subdir)
          .onChange(async (value) => {
            this.plugin.settings.subdir = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Verbose logging")
      .setDesc("Log date fallbacks and per-file details to the Obsidian developer console.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.verbose)
          .onChange(async (value) => {
            this.plugin.settings.verbose = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
```

- [ ] **Step 3: Create initial `main.ts`**

```ts
import { Plugin, Notice } from "obsidian";
import { DEFAULT_SETTINGS, KnowledgeGraphSyncSettingTab } from "./settings";
import type { SyncSettings, SyncResult } from "./types";

export default class KnowledgeGraphSyncPlugin extends Plugin {
  settings: SyncSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "sync-knowledge-graph",
      name: "Sync knowledge graph to MongoDB",
      callback: async () => {
        new Notice("Sync not yet implemented");
      },
    });

    this.addSettingTab(new KnowledgeGraphSyncSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 4: Build and check**

Run: `npm run build`

Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add types.ts settings.ts main.ts
git commit -m "feat: add settings schema and plugin shell"
```

---

### Task 3: Date Utility and Link Resolver

**Files:**
- Create: `date-util.ts`
- Create: `link-resolver.ts`
- Create: `tests/date-util.test.ts`
- Create: `tests/link-resolver.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveCreatedAt(stat, filename, verbose)`, `resolveLinks(file, metadataCache, vault)`.

- [ ] **Step 1: Create `date-util.ts`**

```ts
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
```

- [ ] **Step 2: Write failing test for `date-util.ts`**

Create `tests/date-util.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveCreatedAt } from "../date-util";

describe("resolveCreatedAt", () => {
  it("uses ctime when valid", () => {
    const result = resolveCreatedAt(
      { ctime: 1700000000000, mtime: 1600000000000, size: 100 },
      "A.md",
      false
    );
    expect(result.date.getTime()).toBe(1700000000000);
    expect(result.source).toBe("ctime");
    expect(result.fallback).toBe(false);
  });

  it("falls back to mtime when ctime is invalid", () => {
    const result = resolveCreatedAt(
      { ctime: 0, mtime: 1600000000000, size: 100 },
      "A.md",
      false
    );
    expect(result.date.getTime()).toBe(1600000000000);
    expect(result.source).toBe("mtime");
    expect(result.fallback).toBe(true);
  });

  it("falls back to current date when both are invalid", () => {
    const before = Date.now();
    const result = resolveCreatedAt(
      { ctime: NaN, mtime: NaN, size: 100 },
      "A.md",
      false
    );
    expect(result.date.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.source).toBe("mtime");
    expect(result.fallback).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run tests/date-util.test.ts`

Expected: FAIL because Vitest config does not exist yet.

- [ ] **Step 4: Add Vitest configuration**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

Add to `package.json` scripts (already present from scaffolding).

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run tests/date-util.test.ts`

Expected: PASS.

- [ ] **Step 6: Create `link-resolver.ts`**

```ts
import type { MetadataCache, TFile } from "obsidian";
import { basenameWithoutExtension } from "./path-util";

export function resolveLinks(
  file: TFile,
  metadataCache: MetadataCache
): string[] {
  const cache = metadataCache.getCache(file.path);
  if (!cache?.links) {
    return [];
  }

  const result: string[] = [];
  for (const link of cache.links) {
    // Resolves extensionless basenames, folder-relative paths, and aliases
    // to the destination TFile; returns null when the target does not exist.
    const target = metadataCache.getFirstLinkpathDest(link.link, file.path);
    if (target && target.extension === "md") {
      result.push(basenameWithoutExtension(target.path));
    }
  }
  return result;
}
```

- [ ] **Step 7: Write tests for `link-resolver.ts`**

Create `tests/link-resolver.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveLinks } from "../link-resolver";
import type { MetadataCache, TFile } from "obsidian";

function makeFile(path: string, extension = "md"): TFile {
  return {
    path,
    extension,
    stat: { ctime: 1, mtime: 1, size: 1 },
    basename: path.replace(/\.md$/, ""),
    name: path.split("/").pop() || path,
    parent: null,
  } as unknown as TFile;
}

function makeCache(
  links: Array<{ link: string; original: string }>,
  files: TFile[]
): MetadataCache {
  return {
    getCache: () => ({ links }),
    getFirstLinkpathDest: (linkPath: string) =>
      files.find(
        (f) => f.path === linkPath || f.path === `${linkPath}.md`
      ) || null,
  } as unknown as MetadataCache;
}

describe("resolveLinks", () => {
  it("returns resolved markdown link targets (extensionless link)", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const cache = makeCache([{ link: "B", original: "[[B]]" }], [a, b]);

    expect(resolveLinks(a, cache)).toEqual(["B"]);
  });

  it("excludes unresolved links", () => {
    const a = makeFile("A.md");
    const cache = makeCache([{ link: "Missing", original: "[[Missing]]" }], [a]);

    expect(resolveLinks(a, cache)).toEqual([]);
  });

  it("excludes non-markdown targets", () => {
    const a = makeFile("A.md");
    const img = makeFile("image.png", "png");
    const cache = makeCache([{ link: "image.png", original: "![[image.png]]" }], [a, img]);

    expect(resolveLinks(a, cache)).toEqual([]);
  });

  it("returns multiple links in order", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const c = makeFile("C.md");
    const cache = makeCache(
      [
        { link: "B", original: "[[B]]" },
        { link: "C", original: "[[C]]" },
      ],
      [a, b, c]
    );

    expect(resolveLinks(a, cache)).toEqual(["B", "C"]);
  });
});
```

- [ ] **Step 8: Run the link-resolver tests**

Run: `npx vitest run tests/link-resolver.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add date-util.ts link-resolver.ts tests/date-util.test.ts tests/link-resolver.test.ts vitest.config.ts
git commit -m "feat: add date fallback and link resolver with tests"
```

---

### Task 4: Snapshot Builder and Sync Orchestrator

**Files:**
- Create: `sync.ts`
- Create: `tests/sync.test.ts`

**Interfaces:**
- Consumes: `resolveCreatedAt` from `date-util.ts`, `resolveLinks` from `link-resolver.ts`, `NoteSnapshot`, `SyncSettings`, `SyncResult` from `types.ts`.
- Produces: `buildSnapshot(vault, metadataCache, settings)`, `runSync(vault, metadataCache, mongoStore, settings)`.

- [ ] **Step 1: Create `sync.ts`**

```ts
import type { MetadataCache, TFile, Vault } from "obsidian";
import { resolveCreatedAt } from "./date-util";
import { resolveLinks } from "./link-resolver";
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
  for (const file of files) {
    try {
      const { date: createdAt } = resolveCreatedAt(
        file.stat,
        file.path,
        settings.verbose
      );
      const links = resolveLinks(file, metadataCache);
      snapshot.push({
        filename: basenameWithoutExtension(file.path),
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
```

- [ ] **Step 2: Write tests for `sync.ts`**

Create `tests/sync.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildSnapshot, runSync } from "../sync";
import type { MetadataCache, TFile, Vault } from "obsidian";
import type { MongoStore } from "../mongo";
import type { SyncSettings } from "../types";

function makeFile(path: string, ctime = 1700000000000): TFile {
  return {
    path,
    extension: "md",
    stat: { ctime, mtime: ctime, size: 1 },
    basename: path.replace(/\.md$/, ""),
    name: path.split("/").pop() || path,
    parent: null,
  } as unknown as TFile;
}

function makeVault(files: TFile[]): Vault {
  return {
    getMarkdownFiles: () => files,
    getAbstractFileByPath: (path: string) =>
      files.find((f) => f.path === path) || null,
  } as unknown as Vault;
}

function makeCache(
  linksByPath: Record<string, Array<{ link: string; original: string }>>,
  files: TFile[]
): MetadataCache {
  return {
    getCache: (path: string) => ({ links: linksByPath[path] || [] }),
    getFirstLinkpathDest: (linkPath: string) =>
      files.find(
        (f) => f.path === linkPath || f.path === `${linkPath}.md`
      ) || null,
  } as unknown as MetadataCache;
}

const baseSettings: SyncSettings = {
  mongoUri: "mongodb://localhost:27017",
  dbName: "activity-telemetry",
  subdir: "",
  verbose: false,
};

describe("buildSnapshot", () => {
  it("builds a snapshot for all markdown files", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const vault = makeVault([a, b]);
    const cache = makeCache(
      {
        "A.md": [{ link: "B", original: "[[B]]" }],
      },
      [a, b]
    );

    const { snapshot, errors } = buildSnapshot(vault, cache, baseSettings);
    expect(errors).toEqual([]);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toEqual({
      filename: "A",
      createdAt: new Date(1700000000000),
      links: ["B"],
    });
    expect(snapshot[1].filename).toBe("B");
    expect(snapshot[1].links).toEqual([]);
  });

  it("filters by subdirectory", () => {
    const a = makeFile("Projects/A.md");
    const b = makeFile("Notes/B.md");
    const vault = makeVault([a, b]);
    const cache = makeCache({}, [a, b]);

    const { snapshot } = buildSnapshot(vault, cache, {
      ...baseSettings,
      subdir: "Projects",
    });

    expect(snapshot.map((s) => s.filename)).toEqual(["A"]);
  });

  it("reports errors for malformed files without crashing", () => {
    const a = makeFile("A.md");
    const bad = makeFile("Bad.md");
    const vault = makeVault([a, bad]);
    const cache: MetadataCache = {
      getCache: (path: string) => {
        if (path === "Bad.md") {
          throw new Error("metadata cache failure");
        }
        return { links: [] };
      },
    } as unknown as MetadataCache;

    const { snapshot, errors } = buildSnapshot(vault, cache, baseSettings);
    expect(snapshot.map((s) => s.filename)).toEqual(["A"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Bad.md");
    expect(errors[0]).toContain("metadata cache failure");
  });
});

describe("runSync", () => {
  it("returns error when MongoDB URI is missing", async () => {
    const vault = makeVault([]);
    const cache = makeCache({}, []);
    const store = {} as MongoStore;

    const result = await runSync(vault, cache, store, {
      ...baseSettings,
      mongoUri: "",
    });

    expect(result.errors).toContain("MongoDB URI is not configured");
  });

  it("returns error when no notes are found", async () => {
    const vault = makeVault([]);
    const cache = makeCache({}, []);
    const store = {} as MongoStore;

    const result = await runSync(vault, cache, store, baseSettings);

    expect(result.errors).toContain(
      "No markdown notes found in the configured subdirectory"
    );
  });

  it("calls mongoStore.syncNotes and returns counts", async () => {
    const a = makeFile("A.md");
    const vault = makeVault([a]);
    const cache = makeCache({}, [a]);
    const store: MongoStore = {
      syncNotes: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, deleted: 0 }),
    } as unknown as MongoStore;

    const result = await runSync(vault, cache, store, baseSettings);

    expect(store.syncNotes).toHaveBeenCalledWith([
      { filename: "A", createdAt: new Date(1700000000000), links: [] },
    ]);
    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 0, errors: [] });
  });
});
```

- [ ] **Step 3: Run the sync tests**

Run: `npx vitest run tests/sync.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add sync.ts tests/sync.test.ts
git commit -m "feat: add snapshot builder and sync orchestrator with tests"
```

---

### Task 5: MongoDB Store

**Files:**
- Create: `mongo.ts`
- Create: `tests/mongo.test.ts`

**Interfaces:**
- Consumes: `NoteSnapshot` from `types.ts`.
- Produces: `MongoStore` class with `connect()` and `syncNotes(snapshot)`.

- [ ] **Step 1: Install `mongodb-memory-server`**

Run: `npm install --save-dev mongodb-memory-server`

- [ ] **Step 2: Create `mongo.ts`**

```ts
import { MongoClient, Collection, BulkWriteResult } from "mongodb";
import type { NoteSnapshot } from "./types";

export interface SyncCounts {
  inserted: number;
  updated: number;
  deleted: number;
}

export class MongoStore {
  private client: MongoClient | null = null;
  private readonly uri: string;
  private readonly dbName: string;
  private readonly collectionName = "notes";

  constructor(uri: string, dbName: string) {
    this.uri = uri;
    this.dbName = dbName;
  }

  async connect(): Promise<void> {
    if (!this.client) {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  private getCollection(): Collection<NoteSnapshot> {
    if (!this.client) {
      throw new Error("MongoDB client is not connected");
    }
    return this.client.db(this.dbName).collection<NoteSnapshot>(this.collectionName);
  }

  async syncNotes(snapshot: NoteSnapshot[]): Promise<SyncCounts> {
    const collection = this.getCollection();
    const filenames = snapshot.map((n) => n.filename);

    const operations = snapshot.map((note) => ({
      replaceOne: {
        filter: { filename: note.filename },
        replacement: note,
        upsert: true,
      },
    }));

    let inserted = 0;
    let modified = 0;
    if (operations.length > 0) {
      const result: BulkWriteResult = await collection.bulkWrite(operations);
      inserted = result.upsertedCount;
      modified = result.modifiedCount;
    }

    let deleted = 0;
    if (filenames.length > 0) {
      const deleteResult = await collection.deleteMany({
        filename: { $nin: filenames },
      });
      deleted = deleteResult.deletedCount || 0;
    }

    return { inserted, updated: modified, deleted };
  }
}
```

- [ ] **Step 3: Write integration test for `mongo.ts`**

Create `tests/mongo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoStore } from "../mongo";

let mongod: MongoMemoryServer;
let uri: string;
let store: MongoStore;

describe("MongoStore", () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  });

  afterAll(async () => {
    await mongod.stop();
  });

  beforeEach(async () => {
    store = new MongoStore(uri, "test-activity");
    await store.connect();
    const client = new (await import("mongodb")).MongoClient(uri);
    await client.connect();
    await client.db("test-activity").collection("notes").deleteMany({});
    await client.close();
  });

  afterEach(async () => {
    await store.close();
  });

  it("upserts notes and deletes missing ones", async () => {
    const first = await store.syncNotes([
      { filename: "A", createdAt: new Date("2024-01-01"), links: ["B"] },
      { filename: "B", createdAt: new Date("2024-01-02"), links: [] },
    ]);
    expect(first.inserted).toBe(2);
    expect(first.updated).toBe(0);
    expect(first.deleted).toBe(0);

    const second = await store.syncNotes([
      { filename: "A", createdAt: new Date("2024-01-01"), links: ["C"] },
      { filename: "C", createdAt: new Date("2024-01-03"), links: [] },
    ]);
    expect(second.inserted).toBe(1);
    expect(second.updated).toBe(1);
    expect(second.deleted).toBe(1);
  });
});
```

- [ ] **Step 4: Run the mongo tests**

Run: `npx vitest run tests/mongo.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mongo.ts tests/mongo.test.ts package.json package-lock.json
git commit -m "feat: add MongoDB store with integration tests"
```

---

### Task 6: Wire Up the Plugin Command

**Files:**
- Modify: `main.ts`

**Interfaces:**
- Consumes: `runSync` from `sync.ts`, `MongoStore` from `mongo.ts`, `KnowledgeGraphSyncSettingTab` and `DEFAULT_SETTINGS` from `settings.ts`, `SyncSettings` from `types.ts`.
- Produces: fully functional `KnowledgeGraphSyncPlugin`.

- [ ] **Step 1: Rewrite `main.ts` to connect to MongoDB and run sync**

```ts
import { Plugin, Notice } from "obsidian";
import { DEFAULT_SETTINGS, KnowledgeGraphSyncSettingTab } from "./settings";
import { MongoStore } from "./mongo";
import { runSync } from "./sync";
import type { SyncSettings } from "./types";

export default class KnowledgeGraphSyncPlugin extends Plugin {
  settings: SyncSettings;
  private mongoStore: MongoStore | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "sync-knowledge-graph",
      name: "Sync knowledge graph to MongoDB",
      callback: async () => {
        await this.performSync();
      },
    });

    this.addSettingTab(new KnowledgeGraphSyncSettingTab(this.app, this));
  }

  onunload(): void {
    this.mongoStore?.close();
    this.mongoStore = null;
  }

  private async getMongoStore(): Promise<MongoStore> {
    if (!this.mongoStore) {
      this.mongoStore = new MongoStore(this.settings.mongoUri, this.settings.dbName);
      await this.mongoStore.connect();
    }
    return this.mongoStore;
  }

  private async performSync(): Promise<void> {
    try {
      const mongoStore = await this.getMongoStore();
      const result = await runSync(
        this.app.vault,
        this.app.metadataCache,
        mongoStore,
        this.settings
      );

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.error("[Knowledge Graph Sync]", err);
        }
      }

      const message = `Synced ${result.inserted + result.updated + result.deleted} notes: ${result.inserted} added, ${result.updated} updated, ${result.deleted} removed.`;
      new Notice(message, 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Knowledge Graph Sync]", message);
      new Notice(`Sync failed: ${message}`, 8000);
      this.mongoStore?.close();
      this.mongoStore = null;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 2: Build the plugin**

Run: `npm run build`

Expected: build succeeds, `main.js` produced.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add main.ts
git commit -m "feat: wire sync command into Obsidian plugin lifecycle"
```

---

### Task 7: Build Verification and Packaging

**Files:**
- Modify: `esbuild.config.mjs`
- Modify: `README.md`
- Modify: `.gitignore` (create if missing)

**Interfaces:**
- Consumes: plugin source.
- Produces: production-ready plugin bundle and documentation.

- [ ] **Step 1: Ensure `mongodb` is bundled and `obsidian` is external**

Verify `esbuild.config.mjs` already has (from Task 1):

```js
external: [
  "obsidian",
  "electron",
  "@codemirror/*",
  "moment",
],
```

`mongodb` must NOT be in this list so it is bundled.

Also verify the config uses `platform: "node"` and `target: "es2020"`. This is required to bundle the `mongodb` driver: `platform: "node"` externalizes Node built-ins (`net`, `tls`, `fs`, `crypto`, …) so the emitted `main.js` can `require()` them at runtime, and `target: "es2020"` satisfies the driver's BigInt literals. Obsidian desktop plugins can `require()` Node built-ins (manifest `isDesktopOnly: true`).

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
main.js
*.js.map
data.json
.DS_Store
```

- [ ] **Step 3: Update `README.md` with install and usage instructions**

```markdown
# Knowledge Graph Sync

Obsidian plugin that syncs a minimal metadata snapshot of your vault to a MongoDB `notes` collection.

## Required settings

- **MongoDB connection string** — e.g. `mongodb://localhost:27017`
- **Database name** — defaults to `activity-telemetry`
- **Vault subdirectory** — optional; restrict sync to one folder
- **Verbose logging** — log date fallbacks to the developer console

## Usage

1. Build: `npm run build`
2. Copy `manifest.json`, `main.js`, and `versions.json` to your vault’s `.obsidian/plugins/knowledge-graph-sync/` folder.
3. Open Obsidian, enable the plugin, configure settings.
4. Run **"Sync knowledge graph to MongoDB"** from the command palette.

## Testing

```bash
npm test
```

## Notes

- Only markdown wikilinks are synced. Unresolved ones are dropped unless the include-notes-that-don't-exist-yet setting is enabled, in which case they are kept as edges and the missing notes appear as placeholder nodes.
- Files removed from the vault are removed from MongoDB on the next sync.
```

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: `main.js` created, no sourcemap in production, no errors.

- [ ] **Step 5: Inspect bundle size**

Run: `ls -lh main.js`

Log the size. If it is unexpectedly large (>5 MB), review esbuild tree-shaking and consider whether the MongoDB driver can be replaced by a lighter HTTP client.

- [ ] **Step 6: Run full test suite again**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add .gitignore esbuild.config.mjs README.md
git commit -m "chore: production build config and documentation"
```

---

### Task 8: .env Configuration

Implemented 2026-09-22. Spec: [Addendum: .env configuration](../specs/2026-08-13-obsidian-sync-design.md#addendum-env-configuration-2026-09-22).

**Files:**

- Create: `env-config.ts`, `tests/env-config.test.ts`, `.env.example`, `.env` (local only)
- Modify: `.gitignore`, `main.ts`, `settings.ts`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Ignore `.env` before creating it**

Add `.env` to `.gitignore`. Verify: `git check-ignore -v .env` → `.gitignore:5:.env`. `.env.example` must stay tracked — the pattern has no wildcard, so it does not match.

- [ ] **Step 2: Write `env-config.ts`**

Exports: `parseEnvFile`, `envConfigFromEntries`, `effectiveSettings`, `readEnvConfig`, `EMPTY_ENV_CONFIG`, and the `EnvConfig` type (`settings`, `managedKeys`, `warnings`). No parser dependency — flat `KEY=VALUE` only. `readEnvConfig` treats `ENOENT` as "no `.env`" and converts every other error into a warning; it never throws.

- [ ] **Step 3: Test the module**

Run: `npx vitest run tests/env-config.test.ts`

Expected: 21 passing — parser cases (comments, blanks, CRLF, quotes, `=` in values, empty values, malformed lines), key mapping and boolean coercion, unknown-key warnings, per-key precedence, and filesystem cases (missing file, unreadable path, mixed valid/invalid file).

- [ ] **Step 4: Wire `main.ts`**

Keep the layers separate: `persistedSettings` (UI-owned, what `saveSettings()` writes), `envConfig` (never persisted), and `getEffectiveSettings()` = defaults < persisted < env. Read `.env` in `loadSettings()`, at the top of `performSync()`, and from the settings tab. `getMongoStore(settings)` must take the **effective** settings, or the client would connect with the persisted URI while the sync ran with the env one.

- [ ] **Step 5: Make the settings tab env-aware**

Banner naming the `.env` path, and `.setDisabled(true)` on each control whose key `.env` defines, displaying the effective value. Keys `.env` does not define stay editable and save as before.

- [ ] **Step 6: Create `.env` and `.env.example`**

`.env.example` is committed and documents all five keys. The local `.env` sets `MONGO_URI`, `DB_NAME`, `SUBDIR`, `INCLUDE_UNRESOLVED`, and deliberately omits `VERBOSE` so the debugging toggle stays live in the UI.

- [ ] **Step 7: Verify**

Run: `npm test` then `npm run build`

Expected: all tests pass; `tsc -noEmit` clean; `main.js` still bundles the MongoDB driver (not in `external`).

---

## Self-Review

**1. Spec coverage**

- ✅ One document per markdown note in `notes` collection — implemented in `MongoStore.syncNotes`.
- ✅ Document shape `{ filename, createdAt, links }` — defined in `types.ts` and used in snapshot builder.
- ✅ Basename `filename` without directory or `.md` extension — `basenameWithoutExtension(TFile.path)`.
- ✅ `createdAt` from `ctime` falling back to `mtime` — `resolveCreatedAt`.
- ✅ `links` resolved to markdown targets — `resolveTargets`, with unresolved targets opt-in via the include-notes-that-don't-exist-yet setting.
- ✅ Manual sync command — registered in `main.ts`.
- ✅ Delete missing notes from MongoDB — `deleteMany` in `MongoStore.syncNotes`, with empty-list safety.
- ✅ Configurable MongoDB URI, DB name, subdirectory, verbose — settings tab.
- ✅ Does not modify website repo — plugin is standalone.

**2. Placeholder scan**

- No TBD/TODO/"implement later"/"add appropriate error handling"/"similar to Task N" found.
- Every step includes concrete file paths, code, or commands.

**3. Type consistency**

- `NoteSnapshot`, `SyncSettings`, `SyncResult` defined once in `types.ts` and used consistently.
- `MongoStore.syncNotes` returns `SyncCounts` with `inserted`, `updated`, `deleted`, matching `runSync` expectations.
- `resolveCreatedAt` returns `DateResolution` with `date`, `source`, `fallback`.

No issues remain.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-obsidian-sync.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach would you like?
