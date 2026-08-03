// IndexedDB adapter — same interface as adapter-memory.js. Browser-only;
// domain rules live in repo.js (tested in node against the memory adapter),
// so this file stays a thin promise wrapper.
const DB_NAME = "disneytracker";
// Exported: a backup records the schema it was written against, so a snapshot
// from a newer build can be refused at the door (js/storage/backup.js).
export const DB_VERSION = 3;   // v3: trip_discounts (DATA-MODEL §3)

// store → indexed fields (repo.byIndex targets)
const SCHEMA = {
  trips: ["plan_group_id"],
  segments: ["trip_id", "hotel_id"],
  trip_discounts: ["trip_id"],
  hotels: ["name"],
  expenses: ["trip_id"],
  overrides: [],
  settings: [],
  dvc_contracts: ["resort_hotel_id"],
  dvc_reservations: ["segment_id"],
  dvc_point_entries: ["contract_id", "reservation_id"],
};

const req = r => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

export async function openIdb() {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const [store, indexes] of Object.entries(SCHEMA)) {
      if (!db.objectStoreNames.contains(store)) {
        const os = db.createObjectStore(store, { keyPath: "id" });
        for (const f of indexes) os.createIndex(f, f);
      }
    }
  };
  const db = await req(open);
  const os = (store, mode) => db.transaction(store, mode).objectStore(store);
  return {
    get: (store, id) => req(os(store, "readonly").get(id)),
    put: async (store, obj) => { await req(os(store, "readwrite").put(obj)); return obj.id; },
    delete: (store, id) => req(os(store, "readwrite").delete(id)),
    getAll: store => req(os(store, "readonly").getAll()),
    byIndex: (store, field, value) =>
      req(os(store, "readonly").index(field).getAll(value)),

    // Wholesale replacement — the one operation the handoff model needs.
    // ONE transaction across every store, deliberately: IndexedDB aborts a
    // transaction as a unit, so a failure part-way rolls the whole restore
    // back. Ten separate transactions would leave the database half replaced,
    // which is the worst possible outcome for an operation whose entire
    // purpose is to be total.
    replaceAll: stores => new Promise((res, rej) => {
      const names = Object.keys(stores);
      const tx = db.transaction(names, "readwrite");
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error ?? new Error("restore aborted"));
      for (const name of names) {
        const store = tx.objectStore(name);
        store.clear();
        for (const row of stores[name]) store.put(row);
      }
    }),
  };
}
