// DVC point/reservation logic (specs/DVC-SPEC.md). Pure functions — no
// storage, no DOM. Reservations are per lodging segment (DATA-MODEL.md §5b,
// 2026-07-25): a split stay with two on_points segments is two reservations,
// each FK'd to its segment_id, never to the trip directly.

// UY label = calendar year of the use-year's start month. Current UY = the
// latest use-year whose start is on or before `today`.
function uyStart(contract, uyYear) {
  return new Date(Date.UTC(uyYear, contract.use_year_month - 1, 1));
}

export function currentUY(contract, today = new Date()) {
  const y = today.getUTCFullYear();
  return uyStart(contract, y) <= today ? y : y - 1;
}

// UY containing a given check-in date, per that contract's use_year_month.
export function uyFor(contract, checkInDate) {
  return currentUY(contract, new Date(checkInDate + "T00:00:00Z"));
}

// balance(contract, uy) = points_per_year + Σ ledger entries for that UY.
// Never stored — recomputed from entries every time (frozen law).
export function balance(contract, uy, entries) {
  return contract.points_per_year +
    entries.filter(e => e.contract_id === contract.id && e.use_year === uy)
      .reduce((s, e) => s + e.points, 0);
}

// The 3-year outlook window: the CALENDAR triple [Y-1, Y, Y+1] — the same
// three columns for every contract (the design director, 2026-08-02).
//
// This line has been wrong twice, in opposite directions, which is why the
// reasoning is kept in full:
//
// 1. It shipped as [uy0, uy0+1, uy0+2] — the window specs/DVC-SPEC.md STRUCK
//    OUT on 2026-07-25. The struck line is kept in the spec precisely so the
//    rejected window cannot come back, and it had come back here anyway. It
//    survived because `outlook()` had NO CALLERS (dvc.html carried its own
//    copy) and because tests/dvc.test.mjs asserted the rejected window BY
//    NAME. Dead code plus a test that agrees with it is worse than dead code
//    alone: the next screen wanting an outlook would have imported this and
//    been told it was right.
//
// 2. The correction to last/this/next was still PER CONTRACT, and that broke
//    on real data. Reported from the design director's own ledger: *"I am already
//    spending 2027 points."* Borrowing reaches the next use year, and a
//    September–December use year is still living in UY 2025 in August 2026 —
//    so her window was [2024, 2025, 2026] and **the 2027 she was actually
//    spending had no column at all.** The year she most needed was the one
//    the screen could not show.
//
// The calendar triple also fixes a defect per-contract windows made
// unavoidable: renderOverview draws ONE header, taken from contracts[0], while
// each row used its own contract's years — so two contracts with different
// use-year months put their numbers under the wrong headings. One shared
// triple makes the single header correct by construction.
//
// The columns are still USE YEARS. `balance()` keys on use_year and nothing
// about the ledger changed; what changed is WHICH three use-year numbers are
// shown.
//
// ⚠ CONSEQUENCE: the current column is no longer always the middle one. For a
// Sep–Dec use year the live column is Y-1, i.e. the LEFT one. The board draws
// the middle pill active, so a renderer must derive the highlight from
// currentUY() and never from the index — see `current` below, and
// renderOverview. Highlighting the middle regardless would tell that member
// they are spending a year they have not entered yet, which is a worse lie
// than the board deviation.
//
// UTC to match currentUY(), so the two cannot disagree across a New Year.
export function outlookYears(today = new Date()) {
  const y = today.getUTCFullYear();
  return [y - 1, y, y + 1];
}

// One row per contract, three columns, balances derived per column. Every row
// spans the SAME three years now, so a caller can draw one header for all of
// them. `current` marks which column is that contract's live use year — it is
// not always the middle one, so a renderer must read this rather than assume.
export function outlook(contracts, entries, today = new Date()) {
  const years = outlookYears(today);
  return contracts.map(c => {
    const uy0 = currentUY(c, today);
    return {
      contract: c,
      years: years.map(uy => ({ uy, balance: balance(c, uy, entries), current: uy === uy0 })),
    };
  });
}

// Segments eligible for Add Reservation: on_points, no reservation yet, and
// still upcoming (check-out in the future). One at a time; entering a
// reservation removes its segment from this list.
export function eligibleSegments(segments, reservations, trips, today = new Date()) {
  const reserved = new Set(reservations.map(r => r.segment_id));
  return segments.filter(seg => {
    if (!seg.on_points || reserved.has(seg.id)) return false;
    const trip = trips.find(t => t.id === seg.trip_id);
    if (!trip) return false;
    const checkOut = segmentCheckOut(seg);
    return checkOut == null || new Date(checkOut + "T00:00:00Z") >= today;
  });
}

// A segment's check_in may be null (auto-chains after the prior segment) —
// resolving the chain is Trips' job. When present, check_out = check_in + nights.
function segmentCheckOut(seg) {
  if (!seg.check_in) return null;
  const d = new Date(seg.check_in + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + seg.nights);
  return d.toISOString().slice(0, 10);
}

// Add Reservation prefill: full points_total on the contract whose
// resort_hotel_id matches the segment's hotel_id (home-resort match), 0 on
// every other contract. User redistributes only when reality differed.
export function prefillPoints(contracts, segment, pointsTotal) {
  const home = contracts.find(c => c.resort_hotel_id === segment.hotel_id);
  return contracts.map(c => ({ contract_id: c.id,
    points: c === home ? pointsTotal : 0,
    use_year: uyFor(c, segment.check_in ?? new Date().toISOString().slice(0, 10)) }));
}

// SAVE gate: Σ per-contract points must equal the stated total, every value
// >= 0, total > 0. Mirrors Spend's isBlank-style explicit predicate.
export function canSaveReservation(rows, pointsTotal) {
  if (!(pointsTotal > 0)) return false;
  if (rows.some(r => !(r.points >= 0))) return false;
  return rows.reduce((s, r) => s + r.points, 0) === pointsTotal;
}

// All reservations for a trip (joined through its segments) — 04a shows one
// reservation card per on_points segment, not one per trip.
export function reservationsForTrip(trip, segments, reservations) {
  const segIds = new Set(segments.filter(s => s.trip_id === trip.id).map(s => s.id));
  return reservations.filter(r => segIds.has(r.segment_id));
}

// ── dues tracking window ────────────────────────────────────────────────
// The board draws "Track Annual Dues: Yes / No" — a toggle. The storage
// shape is a WINDOW (track_dues_from / track_dues_until), because
// duesRowsFor()'s frozen opt-out behaviour is "stop future generation;
// existing rows remain". A boolean cannot express that: clearing it would
// retroactively erase the dues the user already tracked. These two helpers
// are the only translation between the drawn control and the stored shape.

// Yes → open the window (at `year` the first time; a later Yes never moves
// the original start). No → close it at `year`, keeping the history.
// Saying No to a contract that was never tracked stays untracked, rather
// than inventing a zero-length window.
export function setDuesTracking(contract, on, year) {
  const from = contract.track_dues_from ?? null;
  if (on) return { ...contract, track_dues_from: from ?? year, track_dues_until: null };
  if (from == null) return { ...contract, track_dues_from: null, track_dues_until: null };
  return { ...contract, track_dues_from: from, track_dues_until: year };
}

// What the toggle should render: tracking is live only while the window is
// open. A closed window still yields dues rows for its past years — that is
// duesRowsFor()'s job, not this predicate's.
export function isDuesTracked(contract) {
  return contract.track_dues_from != null && contract.track_dues_until == null;
}

// ── contract row label ──────────────────────────────────────────────────
// The Points Summary and Points Used tables need a SHORT, aligned label per
// contract. Before chunk 4b the row showed the user's free-text nickname, so
// nothing guaranteed either. the design director (2026-07-27) chose a derived
// "resort abbreviation + ordinal" — the VGF 1 / VGF 2 the board draws.
//
// The abbreviation IS the hotel id (data/hotels.json), which is why those ids
// are the community DVC codes and not uuids: three characters, so the column
// stays aligned.
//
// The ordinal is always rendered, even when a resort has one contract. A bare
// "BLT" would silently become "BLT 1" the moment a second BLT contract is
// added, and a row label that changes identity under the user is worse than
// one that is mildly redundant on day one.
export function contractLabel(contract, contracts) {
  const resort = contract.resort_hotel_id;
  if (!resort) return contract.nickname || "—";     // mid-setup: no home resort yet
  // created_at, then id — the tiebreak keeps the ordinal stable across reads
  // rather than following whatever order the store happened to return.
  const order = (a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
    String(a.id).localeCompare(String(b.id));
  const sameResort = contracts.filter(c => c.resort_hotel_id === resort).sort(order);
  const n = sameResort.findIndex(c => c.id === contract.id) + 1;
  return `${resort} ${n || 1}`;
}
