import { describe, it, expect } from "vitest";
import { resolveLinks } from "../link-resolver";
import type { MetadataCache, TFile, Vault } from "obsidian";

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

function makeVault(files: TFile[]): Vault {
  return {
    getAbstractFileByPath: (path: string) =>
      files.find((f) => f.path === path) || null,
  } as unknown as Vault;
}

function makeCache(links: Array<{ link: string; original: string }>): MetadataCache {
  return {
    getCache: () => ({ links }),
  } as unknown as MetadataCache;
}

describe("resolveLinks", () => {
  it("returns resolved markdown link targets", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const vault = makeVault([a, b]);
    const cache = makeCache([{ link: "B.md", original: "[[B]]" }]);

    expect(resolveLinks(a, cache, vault)).toEqual(["B.md"]);
  });

  it("excludes unresolved links", () => {
    const a = makeFile("A.md");
    const vault = makeVault([a]);
    const cache = makeCache([{ link: "Missing.md", original: "[[Missing]]" }]);

    expect(resolveLinks(a, cache, vault)).toEqual([]);
  });

  it("excludes non-markdown targets", () => {
    const a = makeFile("A.md");
    const img = makeFile("image.png", "png");
    const vault = makeVault([a, img]);
    const cache = makeCache([{ link: "image.png", original: "![[image.png]]" }]);

    expect(resolveLinks(a, cache, vault)).toEqual([]);
  });

  it("returns multiple links in order", () => {
    const a = makeFile("A.md");
    const b = makeFile("B.md");
    const c = makeFile("C.md");
    const vault = makeVault([a, b, c]);
    const cache = makeCache([
      { link: "B.md", original: "[[B]]" },
      { link: "C.md", original: "[[C]]" },
    ]);

    expect(resolveLinks(a, cache, vault)).toEqual(["B.md", "C.md"]);
  });
});
