// Google Drive bridge — the whole configuration surface.
//
// The client id is PUBLIC by construction. A static site on GitHub Pages can
// hold no secret, so the OAuth client is a browser client whose id is meant to
// be readable; it identifies the app, it does not authorise anything on its
// own. See README "Connecting Google Drive" for how to mint one.

// Paste the OAuth client id here to switch the feature on. Empty means the
// Sync block renders, explains itself, and does nothing — never a button that
// looks live and throws.
export const CLIENT_ID = "";

// Frozen 2026-08-03 (amends the 2026-08-01 `drive.file` ruling). AppData is
// app-private BY CONSTRUCTION rather than by convention: the folder is hidden
// from Drive's UI and no other app can read it. Still a non-sensitive scope,
// so the reason drive.file was chosen — avoiding Google's sensitive-scope
// verification review — survives the change.
export const SCOPE = "https://www.googleapis.com/auth/drive.appdata";

// One file, replaced in place. There is deliberately no history and no second
// copy: the handoff model has exactly one snapshot in flight (architecture,
// 2026-08-01).
export const FILE_NAME = "wonderplan-backup.json";

export const isConfigured = () => typeof CLIENT_ID === "string" && CLIENT_ID.trim() !== "";
