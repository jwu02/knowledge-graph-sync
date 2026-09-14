import { describe, it, expect } from "vitest";
import { resolveTargets } from "../link-resolver";
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

describe("resolveTargets", () => {
  it("returns empty buckets when the file has no links", () => {
    const a = makeFile("A.md");
    const cache = makeCache([], [a]);

    expect(resolveTargets(a, cache)).toEqual({ resolved: [], unresolved: [] });
  });

  it("returns empty buckets when the file has no cache entry", () => {
    const a = makeFile("A.md");
    const cache = { getCache: () => null } as unknown as MetadataCache;

    expect(resolveTargets(a, cache)).toEqual({ resolved: [], unresolved: [] });
  });

  it("separates existing markdown targets from unresolved ones", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const cache = makeCache(
      [
        { link: "B", original: "[[B]]" },
        { link: "Missing", original: "[[Missing]]" },
      ],
      [a, b]
    );

    expect(resolveTargets(a, cache)).toEqual({
      resolved: ["B"],
      unresolved: ["Missing"],
    });
  });

  it("returns target basenames without directory or .md extension", () => {
    const a = makeFile("Projects/A.md");
    const b = makeFile("Projects/Sub/B.md");
    const cache = makeCache(
      [{ link: "Projects/Sub/B", original: "[[Projects/Sub/B]]" }],
      [a, b]
    );

    expect(resolveTargets(a, cache)).toEqual({
      resolved: ["B"],
      unresolved: [],
    });
  });

  it("excludes existing non-markdown targets from both buckets", () => {
    const a = makeFile("A.md");
    const img = makeFile("image.png", "png");
    const cache = makeCache(
      [{ link: "image.png", original: "[[image.png]]" }],
      [a, img]
    );

    expect(resolveTargets(a, cache)).toEqual({ resolved: [], unresolved: [] });
  });

  it("returns links in document order", () => {
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

    expect(resolveTargets(a, cache)).toEqual({
      resolved: ["B", "C"],
      unresolved: [],
    });
  });

  it("deduplicates repeated occurrences of the same link", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const cache = makeCache(
      [
        { link: "B", original: "[[B]]" },
        { link: "B", original: "[[B]]" },
        { link: "Missing", original: "[[Missing]]" },
        { link: "Missing", original: "[[Missing]]" },
      ],
      [a, b]
    );

    expect(resolveTargets(a, cache)).toEqual({
      resolved: ["B"],
      unresolved: ["Missing"],
    });
  });

  it("deduplicates distinct files that share a basename", () => {
    const a = makeFile("A.md");
    const x = makeFile("X/Same.md");
    const y = makeFile("Y/Same.md");
    const cache = makeCache(
      [
        { link: "X/Same", original: "[[X/Same]]" },
        { link: "Y/Same", original: "[[Y/Same]]" },
      ],
      [a, x, y]
    );

    expect(resolveTargets(a, cache)).toEqual({
      resolved: ["Same"],
      unresolved: [],
    });
  });

  it("strips a folder path from an unresolved target", () => {
    const a = makeFile("A.md");
    const cache = makeCache(
      [{ link: "Sub/Missing", original: "[[Sub/Missing]]" }],
      [a]
    );

    expect(resolveTargets(a, cache)).toEqual({
      resolved: [],
      unresolved: ["Missing"],
    });
  });

  it("includes unresolved targets written with a .md extension", () => {
    const a = makeFile("A.md");
    const cache = makeCache(
      [{ link: "Missing.md", original: "[[Missing.md]]" }],
      [a]
    );

    expect(resolveTargets(a, cache)).toEqual({
      resolved: [],
      unresolved: ["Missing"],
    });
  });

  it("excludes unresolved targets with a non-markdown extension", () => {
    const a = makeFile("A.md");
    const cache = makeCache(
      [{ link: "diagram.png", original: "[[diagram.png]]" }],
      [a]
    );

    expect(resolveTargets(a, cache)).toEqual({ resolved: [], unresolved: [] });
  });

  it("excludes unresolved targets whose name merely contains a dot", () => {
    const a = makeFile("A.md");
    const cache = makeCache(
      [{ link: "Meeting 2024.01.15", original: "[[Meeting 2024.01.15]]" }],
      [a]
    );

    expect(resolveTargets(a, cache)).toEqual({ resolved: [], unresolved: [] });
  });
});
