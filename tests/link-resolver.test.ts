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

  it("returns the target basename without directory or .md extension", () => {
    const a = makeFile("Projects/A.md");
    const b = makeFile("Projects/Sub/B.md");
    const cache = makeCache([{ link: "Projects/Sub/B", original: "[[Projects/Sub/B]]" }], [a, b]);

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

  it("deduplicates duplicate occurrences of the same link", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const cache = makeCache(
      [
        { link: "B", original: "[[B]]" },
        { link: "B", original: "[[B]]" },
      ],
      [a, b]
    );

    expect(resolveLinks(a, cache)).toEqual(["B"]);
  });
});
