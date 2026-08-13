# Knowledge Graph Sync

Obsidian plugin that syncs a minimal metadata snapshot of your vault to a MongoDB `notes` collection.

## Required settings

- **MongoDB connection string** — e.g. `mongodb://localhost:27017`
- **Database name** — defaults to `activity-telemetry`
- **Vault subdirectory** — optional; restrict sync to one folder
- **Verbose logging** — log date fallbacks to the developer console

## Usage

1. Build: `npm run build`
2. Copy `manifest.json`, `main.js`, and `versions.json` to your vault’s `.obsidian/plugins/knowledge-graph-sync/` folder.
3. Open Obsidian, enable the plugin, configure settings.
4. Run **"Sync knowledge graph to MongoDB"** from the command palette.

## Testing

```bash
npm test
```

## Notes

- Only resolved markdown wikilinks are synced.
- Files removed from the vault are removed from MongoDB on the next sync.
