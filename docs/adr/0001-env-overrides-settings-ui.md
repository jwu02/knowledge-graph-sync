# .env overrides the settings UI, per key

**Status:** accepted (2026-09-22)

Settings used to live only in Obsidian's `data.json`: a file the settings UI rewrites on every keystroke, with no documented format, that can't be templated or shared. The MongoDB connection string is also a credential, and needs a home that backup and sync tools skip by convention. So a `.env` file in the plugin directory supplies settings and is the source of truth for any key it defines, with precedence per key: built-in defaults < persisted settings (`data.json`) < `.env`. `main.ts` keeps the three layers as separate state (`persistedSettings`, `envConfig`, and the derived `getEffectiveSettings()`) rather than merging them into one settings object, and syncs consume the effective settings.

## Considered Options

- **One-time seed** — copy `.env` into `data.json` on first run, then let `data.json` win. Rejected: the files drift immediately, and editing `.env` afterwards silently does nothing.
- **Fill gaps** — `.env` supplies only the keys `data.json` lacks. Rejected: every already-configured machine has all keys present, so `.env` would appear broken on exactly the installs that motivated the feature.
- **Merged settings object** — resolve precedence once and let the settings tab mutate the result. Rejected: `saveSettings()` writes that object wholesale, which would copy `.env` values into `data.json` and create a second source of truth; deleting `.env` would then leave a stale copy behind instead of restoring the UI value.

## Consequences

- Settings that `.env` defines render read-only in the settings tab, with a banner naming the file. The UI must never offer an edit the next read would discard.
- A dormant copy of an env-managed value can remain in `data.json`. This is deliberate — it is what makes deleting `.env` restore the previously saved UI value rather than an empty string.
- `.env` must not be able to break a sync: a missing file is the normal case and yields exactly the pre-`.env` behavior, while a malformed one produces console warnings only.
- `.env` never reaches git (it is listed in `.gitignore`), so it cannot propagate through a clone or pull — it must be recreated per machine, from the committed `.env.example`.
