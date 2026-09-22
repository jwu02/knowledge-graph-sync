# Knowledge Graph Sync

Obsidian plugin that syncs a minimal metadata snapshot of your vault to a MongoDB `notes` collection.

## Required settings

- **MongoDB connection string** — e.g. `mongodb://localhost:27017`
- **Database name** — defaults to `activity-telemetry`
- **Vault subdirectory** — optional; restrict sync to one folder
- **Include notes that don't exist yet** — optional; off by default. See below.
- **Verbose logging** — log date fallbacks and placeholder date sources to the developer console

Any of these can also be supplied by a local `.env` file — see [Setting values with .env](#setting-values-with-env).

### Include notes that don't exist yet

When a note links to `[[Something You Haven't Written]]`, the link normally disappears from the sync: no edge, no node. Turn this on and the plugin instead keeps the edge and creates a **placeholder node** for the target — a document with that name and no outgoing links — so referenced-but-unwritten notes show up in the graph.

- Only markdown-looking targets qualify. `[[Foo]]` and `[[Foo.md]]` become nodes; `[[diagram.png]]` and `[[v1.2]]` do not.
- A placeholder never overwrites a real note: if the note exists (even outside the configured subdirectory), it stays the real note.
- Writing the missing note later replaces its placeholder on the next sync, since the name is the document key.
- Turning the setting back off deletes the placeholders on the next sync.
- **Creation date**: a placeholder is dated from the notes that link to it — the earliest creation date among them, taken from that note's own date. So `[[Some Idea]]` referenced by a note from 2021 appears in the graph as a 2021 node, and the date doesn't drift as you re-sync. Notes outside the configured subdirectory are never date sources. Turn on **Verbose logging** to see which note dated each placeholder.

## Setting values with .env

A `.env` file in the plugin folder can supply settings, so a connection string lives in one git-ignored file instead of only in Obsidian’s `data.json`. Copy `.env.example` to `.env` next to it (`.obsidian/plugins/knowledge-graph-sync/.env`) and fill it in.

| Key | Setting |
| --- | --- |
| `MONGO_URI` | MongoDB connection string |
| `DB_NAME` | Database name |
| `SUBDIR` | Vault subdirectory |
| `INCLUDE_UNRESOLVED` | Include notes that don’t exist yet |
| `VERBOSE` | Verbose logging |

```bash
MONGO_URI=mongodb+srv://user:password@cluster.example.mongodb.net/?appName=Cluster0
DB_NAME=activity-telemetry
SUBDIR=02 Knowledge
INCLUDE_UNRESOLVED=on
```

- **`.env` wins per key.** Precedence is built-in defaults, then settings saved in the UI, then `.env` — so a key you leave out of `.env` keeps whatever the settings tab saved. Settings that `.env` defines appear read-only in the settings tab, with a banner naming the file.
- **Format** is one `KEY=VALUE` per line. Blank lines and `#` comments are ignored; quotes around a value are optional; only the first `=` separates key from value, so connection strings with `?query=params` work unquoted. Booleans accept `true`, `on`, or `1` as true — anything else is false. An empty value means “not set here”, and unknown keys are ignored with a warning in the developer console.
- **Reloading** happens at plugin load and before every sync, so an edit applies to the next sync without restarting Obsidian.
- **No `.env`** is the normal case: the plugin behaves exactly as if the file didn’t exist. Deleting it restores the values saved in the settings tab.
- `.env` is git-ignored; it is never copied into `data.json`.

## Usage

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Copy `manifest.json`, `main.js`, and `versions.json` to your vault’s `.obsidian/plugins/knowledge-graph-sync/` folder.
4. Open Obsidian, enable the plugin, configure settings — or copy `.env.example` to `.env` in the plugin folder instead.
5. Run **"Sync knowledge graph to MongoDB"** from the command palette.

## Testing

```bash
npm test
```

## Notes

- Graph node ids (`filename`) and `links` are stored as note basenames — no directory, no `.md` extension — e.g. `My Note`. Two notes with the same name in different folders produce the same node id, so one overwrites the other in MongoDB.
- Only markdown wikilinks are synced. Unresolved targets are dropped unless **Include notes that don't exist yet** is enabled.
- Files removed from the vault are removed from MongoDB on the next sync.
- This plugin writes to the `notes` collection and removes documents that no longer exist in the synced vault subdirectory — it expects exclusive ownership of that collection.
- Links that resolve to notes outside the configured subdirectory are included as-is; those target notes may not be in the `notes` collection, producing dangling edges in the graph.
