# Placeholder dates are derived from linkers, not stamped at sync time

**Status:** accepted (2026-09-22)

A placeholder node — the node emitted for an unresolved wikilink when **Include notes that don't exist yet** is on — originally carried the sync time as its `createdAt`, one timestamp shared by every placeholder in the run. Because the sync replaces documents wholesale, that made the field a "last seen" time that moved on every sync, and gave every unwritten note the same date regardless of how long it had been referenced. A placeholder's date is now the earliest resolved creation date among the notes that link to it, inherited verbatim from the winning linker's own snapshot entry. `buildSnapshot` computes this while it builds the snapshot and stamps no timestamp of its own.

One clock read survives, and it is deliberate: `resolveCreatedAt`'s last resort is `new Date()` for a file with neither a valid `ctime` nor a valid `mtime`. A placeholder linked from such a file inherits that value like any other, so its date can still move between syncs. This is the pre-existing date-resolution rule applied uniformly, not a sync-time stamp — and it is unreachable for files that carry any usable stat.

## Considered Options

- **Keep the sync-time stamp** — rejected: the date is not a fact about the note, and it drifts on every sync, so a graph sorted or coloured by creation date shows placeholders reshuffling for no reason.
- **Keep the sync-time stamp but only on first insert** — the honest way to record "first linked" time. Rejected: it requires reading existing documents before writing, which turns the sync from a one-way write into a read-modify-write and breaks the store's write-only contract. It would also bake a timestamp into a document that the very next full sync may legitimately need to correct.
- **Persist a first-linked timestamp in a side collection** — rejected: more state to keep consistent, and a second collection the plugin would have to own exclusively alongside `notes`.
- **Derive by averaging or taking the latest linker** — rejected: earliest-wins is the only aggregation that is deterministic under vault file ordering, and it matches the intuition that a referenced-but-unwritten note "appeared" when something first pointed at it.

## Consequences

- Placeholder dates are a pure function of the current snapshot, so they are reproducible and need no fake timers in tests.
- A note outside the configured subdirectory is never in the snapshot, so it can never date a placeholder, even though it can still claim a basename.
- The derived date is not a true "first linked" time: deleting the earliest linking note, or excluding its folder, moves the placeholder's date later. This is accepted — the collection is documented as a mirror of the vault subset, not a log.
- Unresolved targets whose basename is claimed by a real note still never become placeholders, so a real note's observed date is never displaced by a derived one.
- With ties broken on the linking note's basename, both the date and the linker named in verbose logs are independent of `getMarkdownFiles()` order.
