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

  it("uses the note basename without directory as the filename", () => {
    const a = makeFile("Projects/Sub/A.md");
    const b = makeFile("Projects/Sub/B.md");
    const vault = makeVault([a, b]);
    const cache = makeCache(
      { "Projects/Sub/A.md": [{ link: "Projects/Sub/B", original: "[[Projects/Sub/B]]" }] },
      [a, b]
    );

    const { snapshot } = buildSnapshot(vault, cache, baseSettings);
    expect(snapshot[0].filename).toBe("A");
    expect(snapshot[0].links).toEqual(["B"]);
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
