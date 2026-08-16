// Portable local-data backup — one validated envelope, used by file
// export/import and by the Google Drive bridge. The snapshot IS the sync unit:
// nothing smaller is ever transmitted or reasoned about (frozen 2026-08-01).
//
// Theme remains deliberately out of this contract: it is display chrome in
// localStorage (see architecture decision), not user financial data. So are
// the sync-local values in js/sync/prefs.js — see that file for why a device
// id inside `settings` would be a bug.
//
// Moved into the app 2026-08-03 (was js-not-shipped/) when Drive landed.

import { APP_VERSION } from "../version.js";
import { DB_VERSION } from "./adapter-idb.js";

export const BACKUP_FORMAT = "disneytracker-backup";

// The ENVELOPE's shape, not the app's build — it changes only when this file's
// structure does. The app's version rides in meta.appVersion.
export const BACKUP_VERSION = 1;

// Keep this explicit rather than copying every IndexedDB object store. A new
// internal cache or migration store must never leak into a user's backup just
// because it was added to adapter-idb.js.
export const BACKUP_STORES = [
  "trips",
  "segments",
  "trip_discounts",
  "hotels",
  "expenses",
  "overrides",
  "settings",
  "dvc_contracts",
  "dvc_reservations",
  "dvc_point_entries",
];

const isObject = value => value != null && typeof value === "object" && !Array.isArray(value);
const sortById = rows => rows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
const fail = message => { throw new Error(`invalid backup: ${message}`); };

// A backup cannot export a graph that will not validate. Under the cascade
// ruling (the design director, 2026-08-16) an orphaned reservation is garbage by
// definition — its segment is gone, and a reservation stores only segment_id, so
// nothing on disk records which stay it was. It cannot be repaired, only dropped.
//
// This exists because the cascade in repo.js governs removals only from the day
// it landed. Any database edited before then already carries orphans, and each
// one blocks BOTH Drive sync and file export — the entire safety net — with a
// raw validator string as the only symptom. Self-healing at the export door
// beats asking a person to run a repair script against their own IndexedDB.
//
// The points return to the balance, because balance() is derived from the ledger
// and never stored. The stay becomes loggable again, which is the correct state:
// it genuinely has no reservation any more.
export async function repairOrphans(db) {
  const live = new Set((await db.getAll("segments")).map(s => s.id));
  const dead = (await db.getAll("dvc_reservations")).filter(r => !live.has(r.segment_id));
  if (!dead.length) return 0;
  const ids = new Set(dead.map(r => r.id));
  for (const entry of await db.getAll("dvc_point_entries"))
    if (ids.has(entry.reservation_id)) await db.delete("dvc_point_entries", entry.id);
  for (const row of dead) await db.delete("dvc_reservations", row.id);
  console.warn(`Dropped ${dead.length} orphaned reservation(s); their points returned to the balance.`);
  return dead.length;
}

export async function createBackup(db, { createdAt = new Date().toISOString(), meta = {} } = {}) {
  await repairOrphans(db);
  const stores = Object.fromEntries(await Promise.all(BACKUP_STORES.map(async store => [
    store,
    sortById(await db.getAll(store)),
  ])));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: createdAt,
    // Identity of the writer, so the reader can say what it is holding.
    // backupTime and created_at are the same instant; backupTime is the one
    // the bridge compares, and it defaults so a caller may omit it.
    meta: {
      appVersion: APP_VERSION,
      schemaVersion: DB_VERSION,
      deviceId: null,
      deviceName: "",
      backupTime: createdAt,
      ...meta,
    },
    stores,
  };
}

// A backup written before `meta` existed still has to sort rather than be
// treated as timeless.
export const backupTimeOf = backup => backup?.meta?.backupTime ?? backup?.created_at ?? null;

export function validateBackup(value) {
  const backup = typeof value === "string" ? JSON.parse(value) : value;
  if (!isObject(backup)) fail("root must be an object");
  if (backup.format !== BACKUP_FORMAT) fail("unrecognized format");
  if (backup.version !== BACKUP_VERSION) fail(`unsupported version ${backup.version}`);
  if (typeof backup.created_at !== "string" || Number.isNaN(Date.parse(backup.created_at)))
    fail("created_at must be an ISO date");
  if (!isObject(backup.stores)) fail("stores must be an object");

  // `meta` is optional and additive — a pre-meta file is still valid — but a
  // meta that IS present must be an object, or backupTimeOf reads nonsense.
  if (backup.meta !== undefined && !isObject(backup.meta)) fail("meta must be an object");

  // ⚠ The one refusal that is about the FUTURE rather than about damage. A
  // device on a later build can write stores and indexes this schema does not
  // have; accepting it would land the failure silently in the data instead of
  // loudly at the door. Older or equal is fine — IndexedDB's own upgrade path
  // handles the climb.
  const schema = backup.meta?.schemaVersion;
  if (schema != null) {
    if (!Number.isInteger(schema)) fail("meta.schemaVersion must be an integer");
    if (schema > DB_VERSION)
      fail(`it was made by a newer version of the app (schema ${schema} > ${DB_VERSION})`);
  }

  const expected = new Set(BACKUP_STORES);
  for (const name of Object.keys(backup.stores)) if (!expected.has(name)) fail(`unknown store ${name}`);
  for (const store of BACKUP_STORES) {
    const rows = backup.stores[store];
    if (!Array.isArray(rows)) fail(`${store} must be an array`);
    const ids = new Set();
    for (const row of rows) {
      if (!isObject(row) || typeof row.id !== "string" || !row.id) fail(`${store} has an invalid row`);
      if (ids.has(row.id)) fail(`${store} repeats id ${row.id}`);
      ids.add(row.id);
    }
  }

  const ids = store => new Set(backup.stores[store].map(row => row.id));
  const requireRef = (store, field, target, nullable = false) => {
    const targetIds = ids(target);
    for (const row of backup.stores[store]) {
      const value = row[field];
      if (nullable && value == null) continue;
      if (typeof value !== "string" || !targetIds.has(value))
        fail(`${store}.${field} references a missing ${target}`);
    }
  };
  requireRef("segments", "trip_id", "trips");
  requireRef("segments", "hotel_id", "hotels");
  requireRef("trip_discounts", "trip_id", "trips");
  requireRef("expenses", "trip_id", "trips", true);
  requireRef("dvc_contracts", "resort_hotel_id", "hotels", true);
  requireRef("dvc_reservations", "segment_id", "segments");
  requireRef("dvc_point_entries", "contract_id", "dvc_contracts");
  requireRef("dvc_point_entries", "reservation_id", "dvc_reservations", true);

  return structuredClone(backup);
}

// Validate first, write second — the reason a malformed snapshot cannot leave
// a half-replaced database.
export async function restoreBackup(db, value) {
  const backup = validateBackup(value);
  await db.replaceAll(backup.stores);
  return Object.fromEntries(BACKUP_STORES.map(store => [store, backup.stores[store].length]));
}
