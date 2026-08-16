// What makes a trip SAVEABLE — one definition, used by the CTA gate and
// matched by repo.saveTrip's throws.
//
// Why this file exists (the design director 2026-08-01): "the save button should not be
// activated until all required fields are filled in. it is the design."
//
// That supersedes the 2026-07-26 rule, which kept the gate deliberately
// narrower than full validation and left "at least one component" to be
// checked when the button was pressed. The gap between the two was
// load-bearing: `repo.saveTrip` rejects what the gate let through, so a
// rejected save looked like a button that did nothing, and the fix for THAT
// was an error state nobody had drawn. A button that cannot be pressed while
// the trip is incomplete has no error to draw.
//
// The gate and the repository must therefore agree exactly. They agree by
// sharing this predicate rather than each keeping a copy — the same failure
// that made three screens forecast a trip differently. `saveTrip` keeps its
// own throws as the last line of defence, because a repository that trusts
// its caller is not a repository; `tests/trip-gate.test.mjs` pins the two
// together so neither can drift.

export const COMPONENTS = ["include_lodging", "include_parks", "include_cruise", "include_abd"];

// Returns every reason the trip cannot be saved, in the order a user fills the
// form. Empty array = saveable. Reasons are returned rather than a bare
// boolean so the gate can say WHY when a state exists to say it in — today
// nothing is drawn for that, so nothing renders them (operating rule 7).
export function whyNotSaveable(trip = {}, segments = []) {
  const why = [];

  // The 2026-07-26 minimum, unchanged — it is a subset of the rule now.
  if (!trip.start_date) why.push("start date");
  if (!trip.end_date) why.push("end date");
  if (!(Number(trip.adults) > 0)) why.push("at least one adult");

  // repo.saveTrip: "trip needs at least one component"
  if (!COMPONENTS.some(k => trip[k])) why.push("at least one component");

  // repo.saveTrip: segments require include_lodging / include_lodging
  // requires >= 1 segment. A stay with no hotel picked is not a segment —
  // readSegments drops it — so "lodging on with nothing named" arrives here
  // as an empty list, which is exactly the case the old gate let through.
  if (trip.include_lodging && segments.length === 0) why.push("a hotel for the stay");
  if (!trip.include_lodging && segments.length) why.push("lodging turned on for the stays entered");

  // A stay is identified either by a seeded id or, off property, by a chosen
  // PRICING TIER — the hotel-name field was retired 2026-08-04, so "named" now
  // means "the user answered which kind of hotel". `readSegments` turns that
  // choice into a real id via ensureOffPropertyHotel before the repository
  // ever sees it, which is why the repository can insist on `hotel_id` while
  // the LIVE form legitimately has none yet.
  for (const seg of segments) {
    if (!seg.hotel_id && !seg.hotel_named) { why.push("a hotel on every stay"); break; }
  }
  for (const seg of segments) {
    if (!(seg.nights >= 1)) { why.push("at least one night on every stay"); break; }
  }

  // Every checked component must carry its own quantity. Added 2026-08-16 with
  // the 0 defaults (the design director): the form now OPENS with 0 in these
  // fields, so without this, "not answered" arrives as an answer of zero — a
  // 0-night cruise saving, and the forecast pricing it at $0 instead of
  // rendering the partial dash. That is operating rule 5: never a fake number.
  //
  // The empty field was what protected this before. Empty became null, null
  // made the trip partial, and partial printed "—". A visible 0 is friendlier
  // to fill in and strictly more dangerous, so the gate now carries the weight
  // the empty field used to.
  if (trip.include_parks && !(Number(trip.park_days) > 0)) why.push("days in park");
  if (trip.include_cruise && !(Number(trip.cruise_nights) > 0)) why.push("cruise nights");
  if (trip.include_abd && !(Number(trip.abd_days) > 0)) why.push("ABD days");
  // The one that is a price rather than a count. Gated for the same reason — a
  // 0 estimate prices the whole component at nothing — but it is the first to
  // reconsider if it proves annoying, since a member may genuinely not know the
  // figure yet while being sure of the dates.
  if (trip.include_abd && !(Number(trip.abd_estimate_amount) > 0)) why.push("an ABD estimate");

  return why;
}

export const isSaveable = (trip, segments) => whyNotSaveable(trip, segments).length === 0;
