import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  EMPTY_ENV_CONFIG,
  effectiveSettings,
  envConfigFromEntries,
  parseEnvFile,
  readEnvConfig,
} from "../env-config";
import type { SyncSettings } from "../types";

const DEFAULTS: SyncSettings = {
  mongoUri: "",
  dbName: "activity-telemetry",
  subdir: "",
  verbose: false,
  includeUnresolved: false,
};

describe("parseEnvFile", () => {
  it("parses simple KEY=VALUE lines", () => {
    expect(parseEnvFile("SUBDIR=Projects")).toEqual({
      entries: { SUBDIR: "Projects" },
      warnings: [],
    });
  });

  it("skips blank lines and # comment lines", () => {
    const { entries, warnings } = parseEnvFile("\n# a comment\n   \nDB_NAME=notes-db\n");
    expect(entries).toEqual({ DB_NAME: "notes-db" });
    expect(warnings).toEqual([]);
  });

  it("handles CRLF line endings and trims whitespace", () => {
    const { entries, warnings } = parseEnvFile("  SUBDIR  =  02 Knowledge  \r\nVERBOSE=on\r\n");
    expect(entries).toEqual({ SUBDIR: "02 Knowledge", VERBOSE: "on" });
    expect(warnings).toEqual([]);
  });

  it("strips matching single or double quotes", () => {
    const { entries } = parseEnvFile(`MONGO_URI="mongodb://localhost:27017"\nDB_NAME='notes-db'\n`);
    expect(entries).toEqual({
      MONGO_URI: "mongodb://localhost:27017",
      DB_NAME: "notes-db",
    });
  });

  it("splits on the first = so values may contain query parameters", () => {
    const { entries, warnings } = parseEnvFile(
      "MONGO_URI=mongodb+srv://user:pass@host/?appName=Cluster0"
    );
    expect(entries).toEqual({
      MONGO_URI: "mongodb+srv://user:pass@host/?appName=Cluster0",
    });
    expect(warnings).toEqual([]);
  });

  it("treats an empty value as key not set", () => {
    expect(parseEnvFile("SUBDIR=\nVERBOSE=on\n").entries).toEqual({ VERBOSE: "on" });
  });

  it("warns on malformed lines instead of throwing", () => {
    const { entries, warnings } = parseEnvFile("no separator\n=orphan value\nGOOD=1\n");
    expect(entries).toEqual({ GOOD: "1" });
    expect(warnings).toEqual([
      ".env line 1: expected KEY=VALUE, skipped",
      ".env line 2: expected KEY=VALUE, skipped",
    ]);
  });
});

describe("envConfigFromEntries", () => {
  it("maps all five recognized keys", () => {
    const config = envConfigFromEntries({
      MONGO_URI: "mongodb://localhost:27017",
      DB_NAME: "notes-db",
      SUBDIR: "02 Knowledge",
      INCLUDE_UNRESOLVED: "on",
      VERBOSE: "off",
    });
    expect(config.settings).toEqual({
      mongoUri: "mongodb://localhost:27017",
      dbName: "notes-db",
      subdir: "02 Knowledge",
      includeUnresolved: true,
      verbose: false,
    });
    expect(config.managedKeys).toEqual([
      "mongoUri",
      "dbName",
      "subdir",
      "includeUnresolved",
      "verbose",
    ]);
  });

  it("maps only the keys present", () => {
    const config = envConfigFromEntries({ SUBDIR: "Projects" });
    expect(config.settings).toEqual({ subdir: "Projects" });
    expect(config.managedKeys).toEqual(["subdir"]);
  });

  it("parses true, on, and 1 case-insensitively as true", () => {
    for (const raw of ["true", "on", "1", "TRUE", "On"]) {
      const config = envConfigFromEntries({ INCLUDE_UNRESOLVED: raw, VERBOSE: raw });
      expect(config.settings.includeUnresolved).toBe(true);
      expect(config.settings.verbose).toBe(true);
    }
  });

  it("parses anything else as false", () => {
    for (const raw of ["off", "false", "0", "yes-please", ""]) {
      const config = envConfigFromEntries({ INCLUDE_UNRESOLVED: raw });
      expect(config.settings.includeUnresolved).toBe(false);
    }
  });

  it("warns on unknown keys and ignores them", () => {
    const config = envConfigFromEntries({ MONGOURL: "typo", SUBDIR: "Projects" });
    expect(config.settings).toEqual({ subdir: "Projects" });
    expect(config.warnings).toEqual([".env: ignoring unknown key MONGOURL"]);
  });

  it("returns an empty config for no entries", () => {
    expect(envConfigFromEntries({})).toEqual(EMPTY_ENV_CONFIG);
  });
});

describe("effectiveSettings", () => {
  it("falls back to defaults when nothing overrides them", () => {
    expect(effectiveSettings(DEFAULTS, null, {})).toEqual(DEFAULTS);
  });

  it("lets persisted settings beat defaults", () => {
    const settings = effectiveSettings(DEFAULTS, { subdir: "Projects" }, {});
    expect(settings.subdir).toBe("Projects");
    expect(settings.dbName).toBe("activity-telemetry");
  });

  it("lets env config beat persisted settings", () => {
    const settings = effectiveSettings(
      DEFAULTS,
      { mongoUri: "mongodb://persisted:27017", subdir: "Persisted" },
      { mongoUri: "mongodb://env:27017" }
    );
    expect(settings.mongoUri).toBe("mongodb://env:27017");
    expect(settings.subdir).toBe("Persisted");
  });

  it("overrides only the keys env config defines", () => {
    const settings = effectiveSettings(
      DEFAULTS,
      { mongoUri: "mongodb://persisted:27017", includeUnresolved: true },
      { dbName: "notes-db" }
    );
    expect(settings).toEqual({
      mongoUri: "mongodb://persisted:27017",
      dbName: "notes-db",
      subdir: "",
      verbose: false,
      includeUnresolved: true,
    });
  });
});

describe("readEnvConfig", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-sync-env-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns an empty config with no warnings when the file is missing", () => {
    expect(readEnvConfig(path.join(dir, "missing.env"))).toEqual(EMPTY_ENV_CONFIG);
  });

  it("reads settings from a .env file", () => {
    const file = path.join(dir, "valid.env");
    fs.writeFileSync(file, '# comment\nMONGO_URI="mongodb://localhost:27017"\nSUBDIR=02 Knowledge\n');
    const config = readEnvConfig(file);
    expect(config.settings).toEqual({
      mongoUri: "mongodb://localhost:27017",
      subdir: "02 Knowledge",
    });
    expect(config.managedKeys).toEqual(["mongoUri", "subdir"]);
    expect(config.warnings).toEqual([]);
  });

  it("warns instead of throwing when the path cannot be read", () => {
    const config = readEnvConfig(dir); // a directory, not a file
    expect(config.settings).toEqual({});
    expect(config.managedKeys).toEqual([]);
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain("Could not read");
  });

  it("keeps valid settings and collects warnings from a mixed file", () => {
    const file = path.join(dir, "mixed.env");
    fs.writeFileSync(file, "SUBDIR=02 Knowledge\nnot a pair\nVERBOSE=on\n");
    const config = readEnvConfig(file);
    expect(config.settings).toEqual({ subdir: "02 Knowledge", verbose: true });
    expect(config.warnings.some((warning) => warning.includes("line 2"))).toBe(true);
  });
});
