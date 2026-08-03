// Guarded localStorage for every sync-local value.
//
// Two rules this file exists to enforce:
//
// 1. Safari in private mode THROWS on localStorage access rather than
//    returning null — the pattern js/theme.js already established. A storage
//    failure has to downgrade to "sync does not remember", never to a broken
//    screen, so every touch is wrapped.
//
// 2. None of this belongs in IndexedDB. The `settings` store is a member of
//    BACKUP_STORES, so a device id kept there would ride along inside the
//    snapshot and the RECEIVING device would adopt the sender's identity —
//    two devices, one id, and "From iPhone" printed on the desktop's own
//    backup. These values describe the device, not the data.

// `dt-` matches the convention js/theme.js set with `dt-theme`.
export const KEYS = {
  deviceId:   "dt-device-id",
  connected:  "dt-drive-connected",
  fileId:     "dt-drive-file-id",
  lastSynced: "dt-last-synced",
};

export function createPrefs(store = globalThis.localStorage) {
  return {
    get(key) {
      try { return store?.getItem(key) ?? null; } catch { return null; }
    },
    // Returns false when the write did not stick, so a caller can tell
    // "saved" from "saved nowhere" instead of assuming.
    set(key, value) {
      try { store?.setItem(key, value); return true; } catch { return false; }
    },
    remove(key) {
      try { store?.removeItem(key); return true; } catch { return false; }
    },
  };
}
