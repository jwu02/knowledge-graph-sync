import { describe, it, expect } from "vitest";
import { basenameWithoutExtension } from "../path-util";

describe("basenameWithoutExtension", () => {
  it("returns the basename without the .md extension for a nested path", () => {
    expect(basenameWithoutExtension("Projects/My Note.md")).toBe("My Note");
  });

  it("returns the name without the .md extension for a root-level path", () => {
    expect(basenameWithoutExtension("A.md")).toBe("A");
  });

  it("strips only the trailing .md extension from the basename", () => {
    expect(basenameWithoutExtension("a.md.md")).toBe("a.md");
  });

  it("leaves non-markdown basenames unchanged", () => {
    expect(basenameWithoutExtension("assets/logo.png")).toBe("logo.png");
  });
});
