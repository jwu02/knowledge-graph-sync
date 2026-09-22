# Knowledge Graph Sync

Obsidian plugin that syncs a minimal metadata snapshot of a vault's markdown notes into a MongoDB collection for a knowledge-graph website.

## Language

### Settings

**Default settings**:
Built-in fallbacks compiled into the plugin. Lowest precedence.
_Avoid_: factory settings, built-ins

**Persisted settings**:
Values the user saved through the settings UI. Beats default settings; loses to env config.
_Avoid_: user settings, stored settings

**Env config**:
Values from the `.env` file in the plugin directory. When a key is present, it is the source of truth for that setting.
_Avoid_: environment variables (it is a file, not the shell environment), dotfile

**Effective settings**:
What a sync actually uses: env config where a key is present, else persisted settings, else default settings.
_Avoid_: resolved settings, merged settings

### Notes & links

**Unresolved target**:
A markdown-looking wikilink whose target note does not exist yet.
_Avoid_: broken link, missing note, uncreated note

**Placeholder node**:
The node emitted for an unresolved target when "Include notes that don't exist yet" is on. No file backs it and it has no outgoing links; writing the target note later replaces it.
_Avoid_: ghost node, stub, uncreated note

**Claimed basename**:
A node name held by a real note. A real note always wins its name, wherever the note lives, so an unresolved target whose name is claimed never becomes a placeholder.
_Avoid_: taken name

**Derived creation date**:
A placeholder node's creation date: the earliest creation date among the notes that link to it. A real note's creation date is instead observed from its file.
_Avoid_: sync date, last-seen time
