// Trip type — the ONE place the experience-type vocabulary lives.
//
// The label is DERIVED from the component flags: DATA-MODEL §1 has no
// trip_type column, so "label logic lives in the app". It was living in two
// apps — Home concatenated ("Park & ABD") while Trips bucketed ("Other") — and
// the same trip read differently depending on which screen you were on. Four
// of the eight combinations disagreed. Hence one module, imported by both.
//
// Vocabulary frozen 2026-07-28 (the design director), seven names, no concatenation:
//
//   lodging only ............ Stay
//   Park .................... Park
//   Cruise .................. Cruise
//   ABD ..................... ABD
//   Park + Cruise ........... Land and Sea
//   Park + ABD .............. Park & Tour
//   Cruise + ABD ............ Sea & Tour
//   Park + Cruise + ABD ..... All The Way
//
// Every name fits the card header, which is the constraint that shaped the
// set: one nowrap line of 271px ending at the edit pencil, less the longest
// heading prefix ("Coming Up : ", 109px) = 162px for the name. The widest of
// these is "Land and Sea" at 120px. The retired "Adventures by Disney" needed
// 195px and ran 33px over the pencil — that was a live defect on Trips, not a
// hypothetical, which is why ABD alone is now the abbreviation.
//
// Adding a name? Measure it at 19px/600 Manrope against the 162px budget
// before it ships, and add a row to tests/trip-type.test.mjs.

export function tripType({ lodging = false, parks = false, cruise = false, abd = false } = {}) {
  if (parks && cruise && abd) return "All The Way";
  if (parks && cruise) return "Land and Sea";
  if (parks && abd) return "Park & Tour";
  if (cruise && abd) return "Sea & Tour";
  if (parks) return "Park";
  if (cruise) return "Cruise";
  if (abd) return "ABD";
  // No experience component at all. A saved trip always has one (repo.saveTrip
  // rejects otherwise), so "Stay" is the lodging-only trip; the dash is for the
  // Trips form, which derives a label live while the boxes are still unticked.
  return lodging ? "Stay" : "—";
}

// Storage rows carry `include_*` flags; the card renderers hold the short
// names. This adapter keeps the mapping in one place too, so a caller cannot
// quietly pass `parks` where a row says `include_parks` and get "Stay".
export const tripTypeOf = trip => tripType({
  lodging: trip.include_lodging, parks: trip.include_parks,
  cruise: trip.include_cruise, abd: trip.include_abd,
});
