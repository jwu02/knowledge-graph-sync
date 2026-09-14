# Knowledge Graph Sync

Obsidian plugin that syncs a minimal metadata snapshot of your vault to a MongoDB `notes` collection.

## Required settings

- **MongoDB connection string** — e.g. `mongodb://localhost:27017`
- **Database name** — defaults to `activity-telemetry`
- **Vault subdirectory** — optional; restrict sync to one folder
- **Include notes that don't exist yet** — optional; off by default. See below.
- **Verbose logging** — log date fallbacks to the developer console

### Include notes that don't exist yet

When a note links to `[[Something You Haven't Written]]`, the link normally disappears from the sync: no edge, no node. Turn this on and the plugin instead keeps the edge and creates a **placeholder node** for the target — a document with that name, no outgoing links, and the sync time as its `createdAt` — so referenced-but-unwritten notes show up in the graph.

- Only markdown-looking targets qualify. `[[Foo]]` and `[[Foo.md]]` become nodes; `[[diagram.png]]` and `[[v1.2]]` do not.
- A placeholder never overwrites a real note: if the note exists (even outside the configured subdirectory), it stays the real note.
- Writing the missing note later replaces its placeholder on the next sync, since the name is the document key.
- Turning the setting back off deletes the placeholders on the next sync.

## Usage

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Copy `manifest.json`, `main.js`, and `versions.json` to your vault’s `.obsidian/plugins/knowledge-graph-sync/` folder.
4. Open Obsidian, enable the plugin, configure settings.
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
