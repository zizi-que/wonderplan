// Domain repository — schema invariants from DATA-MODEL.md v1.1 enforced in
// one place, storage-backend-agnostic (adapter-memory for tests,
// adapter-idb in the browser). Pure ES module, no UI, no globals.

const COMPONENTS = ["include_lodging", "include_parks", "include_cruise", "include_abd"];

// DATA-MODEL §3. A junction rather than an array column, chosen for
// "enforceable enum + dedup via PK" — so this list is the enum, and the row
// id below is the PK pair. Not component-gated: a discount is trip-level and
// has no include_* flag to hang off.
const DISCOUNTS = ["dvc", "annual_pass", "florida_resident", "military", "cast_member"];

// The stored name of an unnamed off-property stay. These are DATA, not chrome:
// they are written into the hotel row and are what any list printing a hotel
// name will show. Must stay in step with the picker's labels in trips.html and
// with dims.tier in data/benchmarks.json (offprop.lodging.*).
const OFFPROP_LABELS = { 1: "Budget", 2: "Midrange", 3: "Upscale", 4: "Luxury" };
const discountId = (trip_id, discount) => `${trip_id}:${discount}`;
const uuid = () => (globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }));

export function createRepo(db) {
  async function nextPlanNumber(planGroupId) {
    const siblings = await db.byIndex("trips", "plan_group_id", planGroupId);
    return siblings.reduce((m, t) => Math.max(m, t.plan_number ?? 0), 0) + 1;
  }

  return {
    // trip + segments are written together; segments are replaced wholesale
    // (the form always submits the full list — no partial segment edits).
    async saveTrip(trip, segments = [], discounts = []) {
      if (!COMPONENTS.some(k => trip[k])) throw new Error("trip needs at least one component");
      // Matches trip-gate.js — a checked component carries its own quantity.
      // The last line of defence for the 0 defaults (2026-08-16): the form now
      // opens with 0 in these fields, and a saved 0 would be priced as $0.
      if (trip.include_parks && !(Number(trip.park_days) > 0))
        throw new Error("parks require park_days > 0");
      if (trip.include_cruise && !(Number(trip.cruise_nights) > 0))
        throw new Error("cruise requires cruise_nights > 0");
      if (trip.include_abd && !(Number(trip.abd_days) > 0))
        throw new Error("abd requires abd_days > 0");
      if (trip.include_abd && !(Number(trip.abd_estimate_amount) > 0))
        throw new Error("abd requires abd_estimate_amount > 0");
      if (!trip.include_lodging && segments.length)
        throw new Error("segments require include_lodging");
      if (trip.include_lodging && segments.length === 0)
        throw new Error("include_lodging requires >= 1 segment");
      for (const seg of segments) {
        if (!(seg.nights >= 1)) throw new Error("segment nights must be >= 1");
        if (!seg.hotel_id) throw new Error("segment requires hotel_id");
      }
      // validated before any write, so a bad value cannot leave a half-saved trip
      for (const d of discounts)
        if (!DISCOUNTS.includes(d)) throw new Error(`unknown discount: ${d}`);
      const id = trip.id ?? uuid();
      const plan_group_id = trip.plan_group_id ?? uuid();
      const plan_number = trip.plan_number ?? await nextPlanNumber(plan_group_id);
      const now = new Date().toISOString();
      await db.put("trips", { ...trip, id, plan_group_id, plan_number,
        created_at: trip.created_at ?? now, updated_at: now });
      // Segments are replaced wholesale, so their ids change on EVERY save —
      // which orphaned any reservation hanging off the old id. Cascade first.
      // Ruling (the design director, 2026-08-16): logged points do not survive
      // a trip edit. Preserving them by matching old segments to new ones was
      // the alternative and was declined — the data is small and rebuildable,
      // and "the same stay" is a judgement the form cannot make.
      for (const old of await db.byIndex("segments", "trip_id", id)) {
        await this.deleteReservationForSegment(old.id);
        await db.delete("segments", old.id);
      }
      let seq = 1;
      for (const seg of segments)
        await db.put("segments", { id: uuid(), trip_id: id, seq: seq++,
          hotel_id: seg.hotel_id, nights: seg.nights,
          check_in: seg.check_in ?? null, on_points: seg.on_points ?? false });
      // replaced wholesale, like segments — the form always submits the full
      // set. The id is the (trip_id, discount) pair, so a repeat in the input
      // collapses onto itself instead of writing a duplicate row.
      for (const old of await db.byIndex("trip_discounts", "trip_id", id))
        await db.delete("trip_discounts", old.id);
      for (const d of discounts)
        await db.put("trip_discounts", { id: discountId(id, d), trip_id: id, discount: d });
      return id;
    },

    async getTrip(id) {
      const trip = await db.get("trips", id);
      if (!trip) return undefined;
      const segments = (await db.byIndex("segments", "trip_id", id))
        .sort((a, b) => a.seq - b.seq);
      return { ...trip, segments, discounts: await this.discountsOf(id) };
    },

    async discountsOf(tripId) {
      return (await db.byIndex("trip_discounts", "trip_id", tripId)).map(r => r.discount);
    },

    async listTrips() { return db.getAll("trips"); },
    async segmentsOf(tripId) { return db.byIndex("segments", "trip_id", tripId); },

    async deleteTrip(id) {
      for (const seg of await db.byIndex("segments", "trip_id", id)) {
        await this.deleteReservationForSegment(seg.id);
        await db.delete("segments", seg.id);
      }
      for (const d of await db.byIndex("trip_discounts", "trip_id", id))
        await db.delete("trip_discounts", d.id);
      await db.delete("trips", id);
    },

    // find-or-create the household-scoped off-property row (DATA-MODEL §2)
    //
    // `stars` (1-4) is what lets the forecaster price the stay — off-property
    // has no seeded tier, so without it the trip is partial and the whole
    // forecast renders "—". It is stored on the HOTEL, not the segment: a
    // household that stays at the same Hampton Inn twice answers the question
    // once. A later stay may correct it (a re-used name with a new star wins),
    // but re-using the name with NO star must not erase what is already known.
    // Naming the hotel is OPTIONAL when a star is given (the design director,
    // 2026-08-04). This is a PLANNER: "four nights somewhere mid-range" is a
    // real plan, and requiring the exact hotel meant the vaguer plan — the one
    // most in need of a forecast — was the one that could not be saved.
    //
    // An unnamed stay resolves to a shared per-star row, so at most four ever
    // exist however many trips use them, and they still read as something in
    // any list that prints a hotel name. `generic` marks them so the form can
    // show an EMPTY name field on reload rather than echoing a label the user
    // never typed. Typing a name later mints a normal row beside them.
    async ensureOffPropertyHotel(name, stars = null) {
      const valid = Number.isInteger(stars) && stars >= 1 && stars <= 4 ? stars : null;
      const typed = String(name ?? "").trim();
      if (!typed && valid == null) throw new Error("an off-property stay needs a name or a star");
      const generic = !typed;
      const key = typed || `Off property — ${OFFPROP_LABELS[valid]}`;

      const existing = (await db.byIndex("hotels", "name", key))
        .find(h => h.category === "off_property");
      if (existing) {
        // A named row learns its star; a generic row already IS its star, so
        // it can never be re-pointed at a different band by a later stay.
        // ⚠ The test is the STORED row's nature, not this call's: a user who
        // types the label verbatim ("Off property — Midrange") lands on the
        // shared row, and must not be able to re-price every past trip using
        // it. Sharing the row is harmless; rewriting its band is not.
        if (!existing.generic && valid != null && existing.stars !== valid)
          await db.put("hotels", { ...existing, stars: valid });
        return existing.id;
      }
      const id = uuid();
      await db.put("hotels", { id, name: key, category: "off_property",
        is_dvc: false, active: true, stars: valid, generic });
      return id;
    },

    async listHotels() { return db.getAll("hotels"); },

    // Ship-time resort seed (data/hotels.json). Safe to run on every boot:
    // it fills gaps only. An id already present is left exactly as stored,
    // so a re-seed can never clobber a row the user has edited, and rows the
    // user created (off-property) are untouched. Returns the insert count.
    // Backfill added 2026-07-28: a row already present is still never
    // overwritten, but a column the SHIPPED row has and the stored row lacks
    // is filled in. Without this, a datasheet that grows a field only reaches
    // new installs — `resort_area` landed on all 19 rows and every store that
    // had already seeded them would have kept returning undefined, on exactly
    // the installs running longest. Missing keys only: a stored value the user
    // edited is never touched, which is the guarantee the skip was protecting.
    async seedHotels(rows) {
      const have = new Map((await db.getAll("hotels")).map(h => [h.id, h]));
      let inserted = 0;
      for (const r of rows) {
        const stored = have.get(r.id);
        if (stored) {
          // A CORRECTION (seed_rev, the design director 2026-08-01). Backfill fills gaps
          // only, so a value that is already stored is otherwise untouchable:
          // re-tiering Shades of Green would have reached new installs and
          // nobody else, leaving every existing store on the old price with
          // nothing on screen to say so. A higher shipped rev lets the
          // datasheet overwrite what it ships — and only what it ships, so
          // columns it says nothing about survive.
          if (r.seed_rev != null && r.seed_rev > (stored.seed_rev ?? 0)) {
            await db.put("hotels", { ...stored, ...r });
            continue;
          }
          const missing = Object.keys(r).filter(k => !(k in stored));
          if (missing.length) {
            await db.put("hotels", { ...stored,
              ...Object.fromEntries(missing.map(k => [k, r[k]])) });
          }
          continue;   // a backfill is not an insert; the count stays honest
        }
        await db.put("hotels", { ...r, active: r.active ?? true });
        inserted++;
      }
      return inserted;
    },

    // ---- expenses (Insights reads these; Spend workbench writes them) ----
    // trip_id is nullable: cash-imputation rows (SPEND-CATEGORIZATION §3.5)
    // are household-level and belong to no single trip. They count toward
    // all-time totals but must never land in a trip's total.
    async saveExpense(expense) {
      const CATEGORIES = ["transportation", "lodging", "food", "activity", "gifts"];
      if (expense.category != null && !CATEGORIES.includes(expense.category)) {
        throw new Error(`unknown category: ${expense.category}`);
      }
      const id = expense.id ?? uuid();
      await db.put("expenses", { ...expense, id });
      return id;
    },

    async listExpenses() { return db.getAll("expenses"); },

    // A null/undefined tripId matches nothing — untied rows are not "a trip".
    async expensesOf(tripId) {
      if (tripId == null) return [];
      return db.byIndex("expenses", "trip_id", tripId);
    },

    // FK restrict (DATA-MODEL §2: hotels FK is `on delete restrict`)
    async deleteHotel(id) {
      const refs = await db.byIndex("segments", "hotel_id", id);
      if (refs.length) throw new Error("hotel is referenced by a lodging segment");
      await db.delete("hotels", id);
    },

    // ---- DVC (DATA-MODEL.md §5b) — contracts, reservations, ledger ----
    async saveContract(contract) {
      if (!(contract.points_per_year > 0)) throw new Error("points_per_year must be > 0");
      if (!(contract.use_year_month >= 1 && contract.use_year_month <= 12))
        throw new Error("use_year_month must be 1-12");
      // expiry_year is intake-only and nullable (DATA-MODEL §5b): a member may
      // not know the deed's end year at setup, and nothing derives from it, so
      // absent stays absent rather than becoming a guess. Only obvious typos
      // are rejected — the range asserts no particular DVC end date.
      if (contract.expiry_year != null &&
          !(Number.isInteger(contract.expiry_year) &&
            contract.expiry_year >= 1990 && contract.expiry_year <= 2200))
        throw new Error("expiry_year must be a year between 1990 and 2200");
      // Dues tracking is a window, not a flag (js/dvc.js setDuesTracking):
      // an end before the start would silently yield no rows at all.
      const { track_dues_from: dFrom, track_dues_until: dUntil } = contract;
      if (dFrom != null && dUntil != null && dUntil < dFrom)
        throw new Error("track_dues_until must not precede track_dues_from");
      const id = contract.id ?? uuid();
      const now = new Date().toISOString();
      await db.put("dvc_contracts", { ...contract, id,
        created_at: contract.created_at ?? now, updated_at: now });
      return id;
    },

    async listContracts() { return db.getAll("dvc_contracts"); },

    // FK restrict — a contract with ledger history can't be deleted outright
    async deleteContract(id) {
      const refs = await db.byIndex("dvc_point_entries", "contract_id", id);
      if (refs.length) throw new Error("contract has ledger entries");
      await db.delete("dvc_contracts", id);
    },

    // One reservation per segment (segment_id FK, on delete cascade lives at
    // the caller: deleting a segment/trip or unchecking on_points must also
    // call deleteReservationForSegment). allocations: [{contract_id, points,
    // use_year}] — one negative ledger entry per contract with points > 0.
    async saveReservation({ segment_id, points_total, notes = null }, allocations) {
      const existing = await db.byIndex("dvc_reservations", "segment_id", segment_id);
      if (existing.length) throw new Error("segment already has a reservation");
      const id = uuid();
      const now = new Date().toISOString();
      await db.put("dvc_reservations", { id, segment_id, points_total, notes,
        created_at: now, updated_at: now });
      for (const a of allocations) {
        if (!(a.points > 0)) continue;
        await db.put("dvc_point_entries", { id: uuid(), contract_id: a.contract_id,
          use_year: a.use_year, points: -a.points, reservation_id: id, note: null });
      }
      return id;
    },

    async listReservations() { return db.getAll("dvc_reservations"); },
    async reservationForSegment(segment_id) {
      const [r] = await db.byIndex("dvc_reservations", "segment_id", segment_id);
      return r;
    },

    // Removal lives outside the DVC tab (Trips: delete trip / uncheck
    // on_points) — deletes the reservation and its deduction entries; points
    // return automatically since balance() is derived, never stored.
    async deleteReservation(id) {
      for (const e of await db.byIndex("dvc_point_entries", "reservation_id", id))
        await db.delete("dvc_point_entries", e.id);
      await db.delete("dvc_reservations", id);
    },

    // The cascade the FK comment above has always promised, and which nothing
    // called until 2026-08-16. Both routes that remove a segment go through it
    // now (saveTrip, deleteTrip); unchecking on_points arrives via saveTrip,
    // since that replaces the whole segment list.
    //
    // What the gap cost: an orphaned reservation kept its ledger entries — they
    // hang off reservation_id, which still resolved — so the points stayed spent
    // while the stay dropped out of the `reserved` set, reappeared in Track Your
    // Points and could be logged AGAIN. It was silent in the UI and only ever
    // caught at the backup door, where validateBackup refuses a dangling
    // segment_id. That refusal is what broke desktop→phone sync.
    async deleteReservationForSegment(segment_id) {
      for (const r of await db.byIndex("dvc_reservations", "segment_id", segment_id))
        await this.deleteReservation(r.id);
    },

    // Manual ledger entry (Reconcile delta, banking/borrowing) — no reservation_id.
    async saveLedgerEntry(entry) {
      const id = entry.id ?? uuid();
      await db.put("dvc_point_entries", { ...entry, id, reservation_id: entry.reservation_id ?? null });
      return id;
    },

    async entriesForContract(contract_id) { return db.byIndex("dvc_point_entries", "contract_id", contract_id); },
    async entriesForReservation(reservation_id) { return db.byIndex("dvc_point_entries", "reservation_id", reservation_id); },
  };
}
