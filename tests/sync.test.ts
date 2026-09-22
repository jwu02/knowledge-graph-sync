import { describe, it, expect, vi } from "vitest";
import { buildSnapshot, runSync } from "../sync";
import type { MetadataCache, TFile, Vault } from "obsidian";
import type { MongoStore } from "../mongo";
import type { NoteSnapshot, SyncSettings } from "../types";

const DEFAULT_TIME = Date.parse("2023-11-14T22:13:20Z");

function makeFile(
  path: string,
  ctime = DEFAULT_TIME,
  mtime = ctime
): TFile {
  return {
    path,
    extension: "md",
    stat: { ctime, mtime, size: 1 },
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
  includeUnresolved: false,
};

const unresolvedSettings: SyncSettings = {
  ...baseSettings,
  includeUnresolved: true,
};

const EARLY = { name: "Early", time: Date.parse("2024-01-02T00:00:00Z") };
const LATE = { name: "Late", time: Date.parse("2024-09-20T00:00:00Z") };

/** Snapshot the placeholder `Missing` gets when each given note links to it. */
function placeholderFor(
  linkers: Array<{ name: string; time: number }>,
  settings: SyncSettings = unresolvedSettings
): NoteSnapshot | undefined {
  const files = linkers.map((linker) => makeFile(`${linker.name}.md`, linker.time));
  const vault = makeVault(files);
  const cache = makeCache(
    Object.fromEntries(
      linkers.map((linker) => [
        `${linker.name}.md`,
        [{ link: "Missing", original: "[[Missing]]" }],
      ])
    ),
    files
  );

  const { snapshot } = buildSnapshot(vault, cache, settings);
  return snapshot.find((note) => note.filename === "Missing");
}

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
      createdAt: new Date(DEFAULT_TIME),
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

  it("omits unresolved links and adds no placeholders when disabled", () => {
    const a = makeFile("A.md");
    const vault = makeVault([a]);
    const cache = makeCache(
      { "A.md": [{ link: "Missing", original: "[[Missing]]" }] },
      [a]
    );

    const { snapshot } = buildSnapshot(vault, cache, baseSettings);

    expect(snapshot.map((s) => s.filename)).toEqual(["A"]);
    expect(snapshot[0].links).toEqual([]);
  });

  it("keeps unresolved links as edges when enabled", () => {
    const a = makeFile("A.md");
    const vault = makeVault([a]);
    const cache = makeCache(
      { "A.md": [{ link: "Missing", original: "[[Missing]]" }] },
      [a]
    );

    const { snapshot } = buildSnapshot(vault, cache, {
      ...baseSettings,
      includeUnresolved: true,
    });

    expect(snapshot[0].links).toEqual(["Missing"]);
  });

  it("creates a placeholder node for each unresolved target when enabled", () => {
    const linkerTime = Date.parse("2024-03-05T10:00:00Z");
    const a = makeFile("A.md", linkerTime);
    const vault = makeVault([a]);
    const cache = makeCache(
      { "A.md": [{ link: "Missing", original: "[[Missing]]" }] },
      [a]
    );

    const { snapshot } = buildSnapshot(vault, cache, unresolvedSettings);

    expect(snapshot).toEqual([
      { filename: "A", createdAt: new Date(linkerTime), links: ["Missing"] },
      { filename: "Missing", createdAt: new Date(linkerTime), links: [] },
    ]);
  });

  it("derives the earliest linking date regardless of file order", () => {
    expect(placeholderFor([EARLY, LATE])).toEqual({
      filename: "Missing",
      createdAt: new Date(EARLY.time),
      links: [],
    });
    expect(placeholderFor([LATE, EARLY])).toEqual({
      filename: "Missing",
      createdAt: new Date(EARLY.time),
      links: [],
    });
  });

  it("inherits an mtime-derived date as-is when the linker has no valid ctime", () => {
    const mtime = Date.parse("2024-05-01T08:00:00Z");
    const a = makeFile("A.md", 0, mtime);
    const vault = makeVault([a]);
    const cache = makeCache(
      { "A.md": [{ link: "Missing", original: "[[Missing]]" }] },
      [a]
    );

    const { snapshot } = buildSnapshot(vault, cache, unresolvedSettings);

    expect(snapshot).toEqual([
      { filename: "A", createdAt: new Date(mtime), links: ["Missing"] },
      { filename: "Missing", createdAt: new Date(mtime), links: [] },
    ]);
  });

  it("never dates a placeholder from a note outside the subdirectory", () => {
    const outsideTime = Date.parse("2020-01-01T00:00:00Z");
    const insideTime = Date.parse("2024-06-01T00:00:00Z");
    const outside = makeFile("Notes/Outside.md", outsideTime);
    const inside = makeFile("Projects/Inside.md", insideTime);
    const vault = makeVault([outside, inside]);
    const cache = makeCache(
      {
        "Notes/Outside.md": [{ link: "Missing", original: "[[Missing]]" }],
        "Projects/Inside.md": [{ link: "Missing", original: "[[Missing]]" }],
      },
      [outside, inside]
    );

    const { snapshot } = buildSnapshot(vault, cache, {
      ...baseSettings,
      subdir: "Projects",
      includeUnresolved: true,
    });

    expect(snapshot.map((note) => note.filename)).toEqual([
      "Inside",
      "Missing",
    ]);
    expect(snapshot[1].createdAt).toEqual(new Date(insideTime));
  });

  it("derives the same placeholder date on repeated syncs", () => {
    // Pinned to the linker's date, so a reintroduced sync-time stamp fails
    // deterministically rather than only across a millisecond boundary.
    expect(placeholderFor([LATE, EARLY])?.createdAt).toEqual(
      new Date(EARLY.time)
    );
    expect(placeholderFor([LATE, EARLY])?.createdAt).toEqual(
      new Date(EARLY.time)
    );
  });

  it("names the winning linker once per placeholder in verbose mode", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      placeholderFor([LATE, EARLY], { ...unresolvedSettings, verbose: true });

      // Assert before restoring: mockRestore() clears the recorded calls.
      const lines = log.mock.calls
        .map((call) => call.join(" "))
        .filter((line) => line.includes("Missing"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(EARLY.name);
    } finally {
      log.mockRestore();
    }
  });

  it("breaks a tie between equally dated linkers on the linker name", () => {
    const time = Date.parse("2024-03-05T10:00:00Z");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      placeholderFor(
        [
          { name: "Zeta", time },
          { name: "Alpha", time },
        ],
        { ...unresolvedSettings, verbose: true }
      );

      const line = log.mock.calls
        .map((call) => call.join(" "))
        .find((entry) => entry.includes("Missing"));
      expect(line).toContain("Alpha");
    } finally {
      log.mockRestore();
    }
  });

  it("collapses a target linked from two notes into one placeholder", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const vault = makeVault([a, b]);
    const cache = makeCache(
      {
        "A.md": [{ link: "Missing", original: "[[Missing]]" }],
        "B.md": [{ link: "Missing", original: "[[Missing]]" }],
      },
      [a, b]
    );

    const { snapshot } = buildSnapshot(vault, cache, unresolvedSettings);

    expect(snapshot.map((s) => s.filename)).toEqual(["A", "B", "Missing"]);
    expect(snapshot[0].links).toEqual(["Missing"]);
    expect(snapshot[1].links).toEqual(["Missing"]);
  });

  it("does not create a placeholder for a basename already held by a real note", () => {
    const a = makeFile("A.md");
    const y = makeFile("Y/Same.md");
    const vault = makeVault([a, y]);
    const cache = makeCache(
      { "A.md": [{ link: "X/Same", original: "[[X/Same]]" }] },
      [a, y]
    );

    const { snapshot } = buildSnapshot(vault, cache, unresolvedSettings);

    expect(snapshot.map((s) => s.filename)).toEqual(["A", "Same"]);
    expect(snapshot[0].links).toEqual(["Same"]);
  });

  it("ignores existing notes outside the subdirectory as placeholder sources", () => {
    const a = makeFile("Projects/A.md");
    const outside = makeFile("Notes/B.md");
    const vault = makeVault([a, outside]);
    const cache = makeCache(
      { "Projects/A.md": [{ link: "Notes/B", original: "[[Notes/B]]" }] },
      [a, outside]
    );

    const { snapshot } = buildSnapshot(vault, cache, {
      ...baseSettings,
      subdir: "Projects",
      includeUnresolved: true,
    });

    expect(snapshot).toEqual([
      {
        filename: "A",
        createdAt: new Date(DEFAULT_TIME),
        links: ["B"],
      },
    ]);
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

  it("still skips the sync for an empty vault when placeholders are enabled", async () => {
    const vault = makeVault([]);
    const cache = makeCache({}, []);
    const store: MongoStore = {
      syncNotes: vi.fn(),
    } as unknown as MongoStore;

    const result = await runSync(vault, cache, store, {
      ...baseSettings,
      includeUnresolved: true,
    });

    expect(result.errors).toContain(
      "No markdown notes found in the configured subdirectory"
    );
    expect(store.syncNotes).not.toHaveBeenCalled();
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
      { filename: "A", createdAt: new Date(DEFAULT_TIME), links: [] },
    ]);
    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 0, errors: [] });
  });
});
