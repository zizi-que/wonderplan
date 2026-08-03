// The bridge itself — decide which way, then move the whole snapshot.
//
// Google Drive is a BRIDGE BETWEEN THE USER'S OWN DEVICES, not a
// synchroniser. Frozen 2026-08-01: "sync is a HANDOFF, not a mirror. No merge,
// ever." Both directions replace everything, because that is what handing a
// folder over means. Nothing here merges, reconciles, or reasons about a
// record — the snapshot is the unit.

import { createBackup, restoreBackup } from "../storage/backup.js";
import { getDeviceId, deviceName } from "./device.js";
import { KEYS } from "./prefs.js";

/* ── the decision ────────────────────────────────────────────────────────
   Pure, and the only place the direction is chosen.

   ⚠ It compares the cloud against WHEN THIS DEVICE LAST EXCHANGED, not
   against the local snapshot's own time. The obvious reading — "local
   backupTime vs cloud backupTime" — cannot work, and fails silently rather
   than loudly: the local snapshot is built fresh on every press, so its time
   is always NOW and therefore always newer. `cloud-newer` could never fire and
   the second device would never be offered the first device's data, which is
   the entire point of the bridge.

   The question is not "which file is newer" but "HAS ANYONE ELSE PUSHED SINCE
   I LAST EXCHANGED", and dt-last-synced is what answers it.

     2pm  phone push   → cloud=2pm  phone.last=2pm
     3pm  desk  pull   → cloud=2pm  desk.last=2pm
     4pm  desk  press  → cloud(2pm) !> desk.last(2pm) → "Upload local data?"
     5pm  phone press  → cloud(4pm)  >  phone.last(2pm) → "A newer backup…"

   Equal resolves to `local-newer`: a device that is level with the cloud and
   presses Sync is asking to push. Distinguishing "level and unchanged" from
   "level and edited" needs a content fingerprint, weighed and declined
   (the design director, 2026-08-03) — so pressing Sync with no changes offers to upload an
   identical snapshot. Harmless, but not a no-op.

   Clock skew is neither corrected nor detected. The user owns the order in
   which they hand off; correcting a clock would be an opinion about which
   device is right. */
export function decide(lastSynced, cloudTime) {
  if (!cloudTime) return "upload-first";
  if (!lastSynced) return "cloud-newer";
  const cloud = Date.parse(cloudTime);
  const local = Date.parse(lastSynced);
  if (Number.isNaN(cloud)) return "local-newer";   // unreadable remote clock — prefer ours
  if (Number.isNaN(local)) return "cloud-newer";
  return cloud > local ? "cloud-newer" : "local-newer";
}

export function createSync({ db, prefs, getDrive, now = () => new Date() }) {
  const meta = at => ({
    deviceId: getDeviceId(prefs),
    deviceName: deviceName(),
    backupTime: at,
  });

  return {
    // One small request, no download: the remote's timestamp rides in file
    // metadata (drive-appdata.js), so deciding costs almost nothing.
    async inspect() {
      const remote = await (await getDrive()).find();
      return { remote, verdict: decide(prefs.get(KEYS.lastSynced), remote?.backupTime) };
    },

    // Replaces the remote copy wholesale. `remote` comes from inspect(); null
    // means there is nothing there yet.
    async push(remote) {
      const at = now().toISOString();
      const snapshot = await createBackup(db, { createdAt: at, meta: meta(at) });
      const content = JSON.stringify(snapshot);
      const drive = await getDrive();

      let fileId = remote?.fileId ?? prefs.get(KEYS.fileId);
      if (fileId) {
        // The file can have been deleted between inspect and here — by the
        // other device, or by a user emptying their Drive. Falling back to
        // create turns that into a first push instead of an error.
        try { fileId = await drive.update(fileId, content, snapshot.meta); }
        catch { fileId = await drive.create(content, snapshot.meta); }
      } else {
        fileId = await drive.create(content, snapshot.meta);
      }

      prefs.set(KEYS.fileId, fileId);
      prefs.set(KEYS.lastSynced, at);
      return { at, fileId };
    },

    // Replaces the LOCAL database wholesale. restoreBackup validates before it
    // writes anything, so a malformed or too-new snapshot cannot leave a
    // half-replaced store.
    async pull(remote) {
      const text = await (await getDrive()).download(remote.fileId);
      const counts = await restoreBackup(db, text);
      // The exchange point is the snapshot's OWN time, not now: this device
      // now holds exactly the cloud copy, so the next comparison must find
      // them level rather than find the local side spuriously newer.
      prefs.set(KEYS.fileId, remote.fileId);
      prefs.set(KEYS.lastSynced, remote.backupTime);
      return counts;
    },
  };
}
