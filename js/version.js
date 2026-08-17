// The app's own version, in one place. Introduced 2026-08-03 with Drive sync:
// a snapshot records the build that wrote it, so a future reader can tell what
// produced the file it is holding.
//
// This is NOT the backup envelope's `version` (js/storage/backup.js), which
// describes the file's SHAPE and changes only when that shape does. This one
// describes the app.
// ── 1.1.0-beta, 2026-08-16 ────────────────────────────────────────────────
// Bumped because a snapshot's meaning changed, not merely its contents. Before
// this build a backup could legitimately carry an ORPHANED reservation — a
// points record whose segment had been deleted by any trip edit — and the app
// had no cascade to prevent it and no repair to clear it. After this build it
// cannot: the cascade stops new ones (repo.saveTrip / deleteTrip) and both
// backup doors sweep the ones already written.
//
// That distinction is only legible from a file if the file says which build
// wrote it, which is what this constant is for. Every snapshot stamps it
// (backup.js `appVersion`), so a 1.0.0-beta file should be treated as possibly
// carrying orphans and a 1.1.0-beta file should not.
//
// BACKUP_VERSION stays at 1 deliberately: the file's SHAPE is unchanged. Only
// the rules about what may appear inside it moved.
export const APP_VERSION = "1.1.0-beta";
