import * as fs from "fs";
import type { SyncSettings } from "./types";

// The .env file lives in the plugin directory (next to data.json) and is the
// source of truth for any setting key it defines.
export interface EnvConfig {
  /** Effective values for the settings defined in .env. */
  settings: Partial<SyncSettings>;
  /** SyncSettings keys managed by .env — the settings tab disables their controls. */
  managedKeys: Array<keyof SyncSettings>;
  /** Non-fatal problems; .env issues are logged and never break a sync. */
  warnings: string[];
}

export const EMPTY_ENV_CONFIG: EnvConfig = { settings: {}, managedKeys: [], warnings: [] };

const ENV_KEY_TO_SETTING: Record<string, keyof SyncSettings> = {
  MONGO_URI: "mongoUri",
  DB_NAME: "dbName",
  SUBDIR: "subdir",
  INCLUDE_UNRESOLVED: "includeUnresolved",
  VERBOSE: "verbose",
};

const TRUE_VALUES: ReadonlySet<string> = new Set(["true", "on", "1"]);

/**
 * Parses flat KEY=VALUE lines. Blank lines and # comment lines are skipped,
 * values may be wrapped in matching quotes, and only the first = separates key
 * from value (so MONGO_URI can carry query parameters). An empty value means
 * the key is not set. Malformed lines are skipped with a warning.
 */
export function parseEnvFile(text: string): { entries: Record<string, string>; warnings: string[] } {
  const entries: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    const key = separator < 1 ? "" : line.slice(0, separator).trim();
    if (!key) {
      warnings.push(`.env line ${index + 1}: expected KEY=VALUE, skipped`);
      continue;
    }
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "") continue;
    entries[key] = value;
  }
  return { entries, warnings };
}

/** Maps parsed .env entries onto SyncSettings keys, ignoring unknown keys. */
export function envConfigFromEntries(entries: Record<string, string>): EnvConfig {
  const settings: Partial<SyncSettings> = {};
  const managedKeys: Array<keyof SyncSettings> = [];
  const warnings: string[] = [];
  for (const envKey of Object.keys(ENV_KEY_TO_SETTING)) {
    const settingKey = ENV_KEY_TO_SETTING[envKey];
    const value = entries[envKey];
    if (value === undefined) continue;
    if (settingKey === "includeUnresolved" || settingKey === "verbose") {
      settings[settingKey] = TRUE_VALUES.has(value.toLowerCase());
    } else {
      settings[settingKey] = value;
    }
    managedKeys.push(settingKey);
  }
  for (const envKey of Object.keys(entries)) {
    if (!(envKey in ENV_KEY_TO_SETTING)) {
      warnings.push(`.env: ignoring unknown key ${envKey}`);
    }
  }
  return { settings, managedKeys, warnings };
}

/** Precedence per key: defaults < persisted settings < env config. */
export function effectiveSettings(
  defaults: SyncSettings,
  persisted: Partial<SyncSettings> | null,
  env: Partial<SyncSettings>
): SyncSettings {
  return Object.assign({}, defaults, persisted, env);
}

/**
 * Reads a .env file. A missing file is the normal no-.env setup and yields an
 * empty config; any other read problem becomes a warning, never a thrown
 * error — sync must keep working.
 */
export function readEnvConfig(envPath: string): EnvConfig {
  let text: string;
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return EMPTY_ENV_CONFIG;
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ...EMPTY_ENV_CONFIG, warnings: [`Could not read ${envPath}: ${message}`] };
  }
  const { entries, warnings } = parseEnvFile(text);
  const mapped = envConfigFromEntries(entries);
  return {
    settings: mapped.settings,
    managedKeys: mapped.managedKeys,
    warnings: [...warnings, ...mapped.warnings],
  };
}
