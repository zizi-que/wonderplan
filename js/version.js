// The app's own version, in one place. Introduced 2026-08-03 with Drive sync:
// a snapshot records the build that wrote it, so a future reader can tell what
// produced the file it is holding.
//
// This is NOT the backup envelope's `version` (js/storage/backup.js), which
// describes the file's SHAPE and changes only when that shape does. This one
// describes the app.
export const APP_VERSION = "1.0.0-beta";
