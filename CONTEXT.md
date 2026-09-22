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
