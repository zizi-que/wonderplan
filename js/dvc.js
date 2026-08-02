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

// 3-year outlook: one row per contract, columns = current UY / +1 / +2.
export function outlook(contracts, entries, today = new Date()) {
  return contracts.map(c => {
    const uy0 = currentUY(c, today);
    return { contract: c, years: [uy0, uy0 + 1, uy0 + 2]
      .map(uy => ({ uy, balance: balance(c, uy, entries) })) };
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
