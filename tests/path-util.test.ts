import { describe, it, expect } from "vitest";
import { stripMarkdownExtension } from "../path-util";

describe("stripMarkdownExtension", () => {
  it("strips the .md extension from a nested path, keeping the directory", () => {
    expect(stripMarkdownExtension("Projects/My Note.md")).toBe("Projects/My Note");
  });

  it("strips the .md extension from a root-level path", () => {
    expect(stripMarkdownExtension("A.md")).toBe("A");
  });

  it("leaves non-markdown paths unchanged", () => {
    expect(stripMarkdownExtension("image.png")).toBe("image.png");
  });

  it("strips only the trailing .md extension", () => {
    expect(stripMarkdownExtension("a.md.md")).toBe("a.md");
  });
});
