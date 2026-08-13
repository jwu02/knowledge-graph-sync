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
