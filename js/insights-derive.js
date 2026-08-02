// Insights derivation layer — INSIGHTS-BUILD §4.
// One input bundle in, one output tree out. No DOM, no globals, no clock:
// `today` is an argument so the same inputs always give the same answer.
// Insights writes nothing, ever (repository philosophy).
import { forecastFromStore, typicalOrNull } from "./forecast-bundle.js";
import { variancePct } from "./format.js";

export const CATEGORIES = ["transportation", "lodging", "food", "activity", "gifts"];

const emptyMix = () => Object.fromEntries(CATEGORIES.map(c => [c, 0]));

// A trip belongs to the calendar year of its START date. A trip spanning
// New Year is counted once, in its start year — never split. Its expenses
// follow the trip, not their own dates, so an airfare bought months early
// (or a folio settled after midnight) lands with the trip it belongs to.
const yearOfTrip = trip => Number(trip.start_date.slice(0, 4));

export function deriveInsights({ trips = [], expenses = [], duesRows = [],
  segments = [], hotels = [], forecast = null, today } = {}) {

  // Filter ONCE, at the top. Planning scenarios never appear anywhere —
  // this is also what kills plan-group double counting, since only one
  // sibling can ever be booked.
  const shown = trips.filter(t => t.status === "booked" || t.status === "completed");
  const shownIds = new Set(shown.map(t => t.id));

  const byTrip = new Map(shown.map(t => [t.id, []]));
  for (const e of expenses) {
    if (e.trip_id != null && shownIds.has(e.trip_id)) byTrip.get(e.trip_id).push(e);
  }

  const years = new Map();
  const yearOf = y => {
    if (!years.has(y)) years.set(y, { year: y, total: 0, tripCount: 0,
      byCategory: emptyMix(), uncategorized: 0, ghost: 0, trips: [] });
    return years.get(y);
  };

  for (const t of shown) {
    const rows = byTrip.get(t.id);
    const y = yearOf(yearOfTrip(t));
    y.tripCount++;
    const mix = emptyMix();
    let actual = 0, uncategorized = 0;
    for (const e of rows) {
      const amt = Math.abs(e.amount ?? 0);
      actual += amt;
      if (CATEGORIES.includes(e.category)) mix[e.category] += amt;
      else uncategorized += amt;   // transient; never a 6th mix segment
    }
    y.total += actual;
    y.uncategorized += uncategorized;
    for (const c of CATEGORIES) y.byCategory[c] += mix[c];

    // Booked-future ghost (INSIGHTS-SPEC §2, PALETTE-CONTRACT layer 3): a
    // BOOKED trip's remaining committed cost = budget_amount − recorded, floor
    // 0. It renders translucent in the YEAR mix bar only, never all-time, and
    // never on a trip card. This is the ONE place Insights reads
    // `budget_amount`: the trip card's "Forecasted" is still engine output,
    // because a forecast is calculated while a budget is what the user
    // committed — different questions, and only the second one can be
    // "remaining". A completed trip has nothing outstanding, so it is skipped.
    if (t.status === "booked" && Number.isFinite(t.budget_amount)) {
      y.ghost += Math.max(0, t.budget_amount - actual);
    }

    y.trips.push(tripCard(t, rows, actual, forecast,
      segments.filter(s => s.trip_id === t.id), hotels));
  }

  // DVC dues are Lodging spend, folded into the year they were generated
  // for. They never attach to a trip (a trip card must not absorb them),
  // and they DO create a year on their own: a member with no trips in 2027
  // still paid, so 2027 gets a Year Card reading "0 trips".
  for (const row of duesRows) {
    const y = yearOf(row.year);
    const amt = Math.abs(row.amount ?? 0);
    y.byCategory.lodging += amt;
    y.total += amt;
  }

  const ordered = [...years.values()].sort((a, b) => b.year - a.year);
  const allTime = {
    total: ordered.reduce((s, y) => s + y.total, 0),
    tripCount: shown.length,
    byCategory: ordered.reduce((acc, y) => {
      for (const c of CATEGORIES) acc[c] += y.byCategory[c];
      return acc;
    }, emptyMix()),
  };

  // All three superlatives are YEAR-scoped, per the Figma all-time-expanded
  // variant: each shows a year above the metric ("Most Days / 2026 /
  // 30 days"), never a trip name. Summing the year is not the same as
  // picking the biggest single trip — two 6-day trips beat one 10-day trip.
  const withTrips = ordered.filter(y => y.tripCount > 0);
  const best = (pick) => withTrips.length
    ? withTrips.reduce((a, b) => (pick(b) > pick(a) ? b : a)) : null;
  const crown = (y, key, value) => y ? { year: y.year, [key]: value(y) } : null;

  // Headers using these are fixed plurals ("Most Trips"), so a value of 1
  // never reads wrong — see format.plural() for the counted labels.
  allTime.superlatives = {
    mostDays: crown(best(y => yearDays(y)), "days", yearDays),
    largestBurn: crown(best(y => y.total), "total", y => y.total),
    mostTrips: crown(best(y => y.tripCount), "count", y => y.tripCount),
  };

  // Fixed ranges anchored to the CURRENT year, not to the newest data — a
  // user whose last trip was 2019 should still see 2024–2026 on a 3Y page,
  // mostly empty. ALL is every year present. With exactly 5 years of data
  // 5Y and ALL are identical; the spec says so, so it is not a bug.
  const thisYear = Number(today.slice(0, 4));
  const present = ordered.map(y => y.year).sort((a, b) => a - b);
  const lastN = n => present.filter(y => y > thisYear - n);

  const cumulative = [];
  let running = 0;
  for (const y of [...ordered].reverse()) {
    running += y.total;
    cumulative.push({ year: y.year, total: running });
  }

  // Accumulation is scoped TO THE SELECTED RANGE (the design director 2026-07-26): a 3Y page
  // accumulates only the last 3 years and starts from zero, so its last point
  // is "what the last 3 years cost" — not a lifetime total cropped to 3 points.
  // Only ALL therefore shows the true lifetime figure, which is the whole
  // reason the ranges exist.
  const totalOf = new Map(ordered.map(y => [y.year, y.total]));
  const accumulate = yrs => {
    let run = 0;
    return yrs.map(year => ({ year, total: (run += totalOf.get(year) ?? 0) }));
  };
  const ranges = { "3Y": lastN(3), "5Y": lastN(5), ALL: present };

  return {
    allTime,
    years: ordered,
    ranges,
    // cumulative === cumulativeBy.ALL; kept because callers already read it
    cumulative,
    cumulativeBy: { "3Y": accumulate(ranges["3Y"]), "5Y": accumulate(ranges["5Y"]),
                    ALL: accumulate(ranges.ALL) },
    hasData: ordered.length > 0,
  };
}

const yearDays = y => y.trips.reduce((s, c) => s + c.days, 0);

const nightsOf = t => Math.round(
  (new Date(t.end_date + "T00:00:00Z") - new Date(t.start_date + "T00:00:00Z")) / 86400000);

function tripCard(trip, rows, actual, forecast, segments = [], hotels = []) {
  // Forecasted is the ENGINE's number, never trip.budget_amount — budget is
  // a Trips-form input, and "forecasts are calculated, never manually
  // entered" is a core principle. A partial forecast yields null: it is not
  // a smaller forecast, and showing its number would invent one.
  /* One shared path (js/forecast-bundle.js): the adapter and the options
     bundle both live there, so this screen cannot forecast a trip differently
     from Trips or Spend — which is exactly what it used to do. */
  const forecasted = typicalOrNull(
    forecastFromStore(forecast, trip, { segments, hotels, expenses: rows }));

  return {
    id: trip.id,
    name: trip.name ?? trip.title ?? "",
    start_date: trip.start_date,
    end_date: trip.end_date,
    days: nightsOf(trip),
    actual,
    forecasted,
    // No colour semantics anywhere downstream: over/under is not a verdict.
    // Shared with Spend's tile since 2026-07-28 — same word, same answer.
    variance: variancePct(actual, forecasted),
  };
}
