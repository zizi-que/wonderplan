// Deterministic forecast engine v1 — FORECASTING.md §1–§5.
// Pure ES module; datasheets injected (benchmarks.json + fingerprints.json +
// dvc-canonical.json). Every term is a band {low, typical, high}; a missing
// benchmark renders the term null and flags the forecast partial — never a
// fake number. Nothing here is ever stored (frozen principle).
//
// v1 decisions — APPROVED by the design director 2026-07-19 (frozen in Project Memory):
//  - season = point-calendar periods: value {P1,P2} · regular {P3,P4,P5} ·
//    peak {P6,P7} (data/dvc-canonical.json, officially verified 2026 chart)
//  - lodging seasonal rate = tier.low × season multiplier, clamped into the
//    tier's researched full-year band (mult and band never double-count)
//  - value-season internal spread constant [1.0, 1.075, 1.15]
//  - food days = nights + 1; dining styles without a child benchmark row use
//    the §3 kid weight 0.6 × adult

export const esc = (x, g, age) => x * Math.pow(1 + g, age);

const VALUE_MULT = { low: 1.0, typical: 1.075, high: 1.15 };
const SEASON_OF_PERIOD = { 1: "value", 2: "value", 3: "regular", 4: "regular", 5: "regular", 6: "peak", 7: "peak" };
const EDGES = ["low", "typical", "high"];

const zero = () => ({ low: 0, typical: 0, high: 0 });
const flat = v => ({ low: v, typical: v, high: v });
const add = (a, b) => ({ low: a.low + b.low, typical: a.typical + b.typical, high: a.high + b.high });
const scale = (b, k) => ({ low: b.low * k, typical: b.typical * k, high: b.high * k });
const escBand = (e, age) => ({
  low: esc(e.low, e.drift_rate, age),
  typical: esc(e.typical, e.drift_rate, age),
  high: esc(e.high, e.drift_rate, age),
});

export function compileForecast(benchmarks, fingerprints, canonical) {
  const byId = {};
  for (const e of benchmarks.entries) byId[e.id] = e;
  const curve = {};
  for (const e of benchmarks.entries) {
    if ((e.metric === "ticket_multiday_total" || e.id === "park.ticket.1day.adult") &&
        e.dims.age === "10+" && !e.dims.hopper) curve[e.dims.days] = e;
  }
  const products = {};
  for (const p of fingerprints.products) products[p.id] = p;
  const seasons = canonical.point_calendar_2026.periods.map(per => ({
    level: SEASON_OF_PERIOD[per.p],
    ranges: per.date_ranges.map(r => {
      const [a, b] = r.split("..");
      return [a.slice(5), b.slice(5)]; // MM-DD windows (2026 calendar; refresh at anchor)
    }),
  }));
  const dues = {};
  /* `association_of` — a resort that belongs to ANOTHER resort's condominium
     association, and therefore has no dues of its own to publish.
     CORRECTED 2026-08-01 (the design director): Polynesian Island Tower is part of Disney's
     Polynesian Villas & Bungalows condominium association. That is a stronger
     statement than "same rate": dues are declared ONCE for an association, so
     these two cannot diverge in a future year the way two independent resorts
     charging alike could. It is also why the 2026 table lists only Polynesian
     Villas & Bungalows — there is nothing separate to list.
     Resolved at compile time and never copied into the datasheet, and applied
     after the real rows so the target is always present. */
  const shared = [];
  for (const r of canonical.dues_history.resorts) {
    if (r.association_of) { shared.push(r); continue; }
    const years = Object.keys(r.dues).map(Number);
    const latest = Math.max(...years);
    // byYear keeps the FULL published history: a past year's dues rate is a
    // published fact, not something to re-derive by escalating backwards.
    dues[r.id] = { dues_pp: r.dues[String(latest)], year: latest,
      g_resort: r.g_resort, byYear: r.dues };
  }
  for (const r of shared) {
    const target = dues[r.association_of];
    if (target) dues[r.id] = { ...target, association_of: r.association_of };
  }
  return { byId, curve, products, seasons, dues,
    childFactor: byId["park.ticket.child_factor"]?.typical ?? 1 };
}

export function seasonOf(C, iso) {
  const md = iso.slice(5);
  for (const s of C.seasons) for (const [a, b] of s.ranges) if (a <= md && md <= b) return s.level;
  return "regular";
}

// majority over stay nights (check_in .. check_out−1); tie → higher season
export function tripSeason(C, checkIn, checkOut) {
  const counts = { value: 0, regular: 0, peak: 0 };
  const d = new Date(checkIn + "T00:00:00Z");
  const end = new Date(checkOut + "T00:00:00Z");
  while (d < end) {
    counts[seasonOf(C, d.toISOString().slice(0, 10))]++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return ["peak", "regular", "value"].reduce((best, s) =>
    counts[s] > counts[best] ? s : best, "peak");
}

const ageOf = (e, year) => year - e.effective_year;

// ---- A. park ------------------------------------------------------------

export function forecastPark(trip, C, year) {
  const A = trip.adults ?? 0, K = trip.kids ?? 0, party = A + K;
  const labels = [];
  let partial = false;
  const term = (bandOrNull) => { if (bandOrNull == null) partial = true; return bandOrNull; };

  // tickets = party-scaled day-curve total (+ hopper adder per ticket)
  let tickets = null;
  const t = C.curve[trip.park_days];
  if (t) {
    tickets = scale(escBand(t, ageOf(t, year)), A + K * C.childFactor);
    if (trip.hopper) {
      const h = C.byId["park.addon.hopper"];
      tickets = add(tickets, scale(escBand(h, ageOf(h, year)), party));
    }
  }
  tickets = term(trip.park_days ? tickets : zero());

  // lodging (v1.1) = Σ segments: nights × per-segment seasonal tier rate.
  // on_points → $0 cash (DVC outlook prices it via dues); missing tier
  // (off-property) → partial, known segments still sum. check_in chains
  // from the previous segment (trip start for seq 1). Legacy single-hotel
  // fields (hotel_tier/nights/dvc_points_stay) remain as the fallback path.
  const segRate = (tierId, checkIn, nights) => {
    // A bare tier ("value") is a Disney band and keeps its historic prefix; a
    // dotted tier ("offprop.lodging.star2") is a full benchmark id. Off-property
    // is NOT a Disney tier and must not borrow one — a Disney Value room is
    // $120-280 tax-inclusive, roughly double a budget motel, so remapping would
    // have produced a confident wrong number rather than the honest blank.
    const tier = C.byId[tierId.includes(".") ? tierId : `park.lodging.${tierId}`];
    if (!tier) return null;
    const tb = escBand(tier, ageOf(tier, year));
    const end = new Date(checkIn + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() + nights);
    const season = tripSeason(C, checkIn, end.toISOString().slice(0, 10));
    const mult = season === "value" ? VALUE_MULT
      : escSeasonMult(C.byId[`park.lodging.season_mult.${season}`]);
    const rate = {};
    for (const e of EDGES) rate[e] = Math.min(Math.max(tb.low * mult[e], tb.low), tb.high);
    return rate;
  };
  let lodging = zero();
  if (Array.isArray(trip.lodging_segments)) {
    let cursor = trip.check_in;
    for (const seg of trip.lodging_segments) {
      const checkIn = seg.check_in ?? cursor;
      const end = new Date(checkIn + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + seg.nights);
      cursor = end.toISOString().slice(0, 10);
      if (seg.on_points) continue;
      const rate = seg.tier ? segRate(seg.tier, checkIn, seg.nights) : null;
      if (rate == null) { partial = true; continue; }
      lodging = add(lodging, scale(rate, seg.nights));
    }
  } else if (!trip.dvc_points_stay && trip.hotel_tier) {
    const rate = segRate(trip.hotel_tier, trip.check_in, trip.nights);
    lodging = rate == null ? term(null) : scale(rate, trip.nights);
  }

  // food = (nights+1) days × Σ per-diem(age, dining_style)
  const days = (trip.nights ?? 0) + 1;
  const style = trip.dining_style === "signature" ? "signature"
    : trip.dining_style === "one_ts_daily" ? "ts_mix" : "qs";
  const adultRow = C.byId[`park.food_per_diem.adult.${style}`];
  let food = null;
  if (adultRow) {
    const ab = escBand(adultRow, ageOf(adultRow, year));
    const childRow = style === "qs" ? C.byId["park.food_per_diem.child.qs"] : null;
    const cb = childRow ? escBand(childRow, ageOf(childRow, year)) : scale(ab, 0.6);
    food = scale(add(scale(ab, A), scale(cb, K)), days);
  }
  food = term(food);

  // addons: Lightning Lane × party × park days · Memory Maker · parking
  let addons = zero();
  if (trip.lightning_lane) {
    const ll = C.byId["park.addon.lightning_lane_multipass"];
    addons = add(addons, scale(escBand(ll, ageOf(ll, year)), party * (trip.park_days ?? 0)));
  }
  if (trip.memory_maker) {
    const mm = C.products["memory-maker-advance"];
    addons = add(addons, flat(esc(mm.price, 0.05, year - mm.effective_year)));
  }
  if (trip.parking_days) {
    const p = C.byId["park.addon.parking_theme_park"];
    addons = add(addons, scale(escBand(p, ageOf(p, year)), trip.parking_days));
  }

  // after-hours party event by trip month (MNSSHP Aug–Oct · MVMCP Nov–Dec)
  let events = zero();
  if (trip.after_hours_party) {
    const month = Number(trip.check_in.slice(5, 7));
    const ev = month >= 8 && month <= 10 ? C.byId["park.party_event.mnsshp"]
      : month >= 11 ? C.byId["park.party_event.mvmcp"] : null;
    events = term(ev ? scale(escBand(ev, ageOf(ev, year)), party) : null);
  }

  // merch = per-person-per-night × party × nights (2026-07-20). The old
  // flat park.merch_per_trip ignored both party and length and was wrong in
  // both directions. Cruise onboard shops live inside cruise.extras_pct, so
  // `nights` here is already the LAND portion for a land+sea trip.
  const merchRow = C.byId["park.merch_pp_night"];
  const merch = scale(escBand(merchRow, ageOf(merchRow, year)),
    party * (trip.nights ?? 0));

  const total = [tickets, lodging, food, addons, events, merch]
    .filter(Boolean).reduce(add, zero());
  if (year > 2026) labels.push("2026 estimate");
  labels.push("rack/non-member cold-start");
  return { tickets, lodging, food, addons, events, merch, total, partial, labels };
}

// season multiplier entries are ratios (drift 0) — read edges directly
const escSeasonMult = e => ({ low: e.low, typical: e.typical, high: e.high });

// ---- B. cruise ----------------------------------------------------------

export function forecastCruise(trip, C, year) {
  const A = trip.adults ?? 0, K = trip.kids ?? 0;
  let partial = false;
  const n = trip.cruise_nights ?? trip.nights;
  const ppn = C.byId[`cruise.fare_ppn.${trip.cabin_class}`];
  const cf = C.byId["cruise.child_fare_factor"];
  let fare = null;
  if (ppn && cf) {
    const pb = escBand(ppn, ageOf(ppn, year));
    fare = {};
    for (const e of EDGES) fare[e] = pb[e] * n * (A + K * cf[e]);
  } else partial = true;

  const g = C.products["dcl-gratuity-standard"];
  const fixed = flat(esc(g.price, 0.04, year - g.effective_year) * (A + K) * n);

  // extras = fare × extras_pct (researched 2026-07-20). The pct is derived
  // from folio settlements, which bundle shore excursions with onboard
  // spend and cannot be split — so extras ABSORBS excursions. The old
  // ports × excursion_pp term is gone; reinstating it would double-count.
  let extras = null;
  const xp = C.byId["cruise.extras_pct"];
  if (fare && xp) {
    extras = {};
    for (const e of EDGES) extras[e] = fare[e] * xp[e];
  } else if (!xp) partial = true;

  const total = [fare, fixed, extras].filter(Boolean).reduce(add, zero());
  return { fare, fixed, extras, total, partial,
    labels: year > 2026 ? ["2026 estimate"] : [] };
}

// ---- C. ABD -------------------------------------------------------------

// ABD is user-quote-driven (the design director 2026-07-20): the user types the package
// price, and the engine adds only what the quote provably excludes — guide
// gratuities, per the official ABD FAQ ($10–12 per guest per guide per day,
// 2 guides on a Land Adventure ≈ 3–4% of package). Airfare is excluded from
// ABD packages and is not modeled; that exclusion is disclosed by label,
// not by a partial flag — a disclosed omission is not a missing benchmark.
export function forecastABD(trip, C, year) {
  const labels = [];
  let base, partial = false;
  if (trip.abd_estimate_amount != null) {
    base = flat(trip.abd_estimate_amount);
    labels.push("user quote");
  } else {
    const A = trip.adults ?? 0, K = trip.kids ?? 0;
    const pp = C.byId["abd.pp_trip"];
    base = scale(escBand(pp, ageOf(pp, year)), A + K * 0.95);
    if (year > 2026) labels.push("2026 estimate");
  }
  const up = C.byId["abd.tip_uplift_pct"];
  let total = base;
  if (up) {
    total = {};
    for (const e of EDGES) total[e] = base[e] * (1 + up[e]);
  } else partial = true;
  labels.push("excludes airfare");
  return { base, total, partial, labels };
}

// ---- trip dispatcher -----------------------------------------------------
// A trip is a set of components, not one domain: land+sea needs park AND
// cruise summed. Nothing else in the engine spans domains, so without this
// a land+sea trip has no single forecast at all.
//
// Food scoping: the frozen rule is food days = nights + 1. On a land+sea
// trip that must mean LAND nights — the cruise fare already includes meals,
// so passing the full trip nights to forecastPark would bill the same days
// twice. Land nights = Σ lodging_segments (ship nights are never segments,
// per Project Memory).
// Transportation rules the engine already prices with a term of its own
// (parking addon, cruise fare). Both categorize as `transportation`, so
// carrying the whole category would bill them twice.
export function modeledTransportRules(prefixes) {
  const rules = prefixes.rules ?? prefixes.prefixes ?? [];
  return new Set(rules.filter(r => r.forecast_modeled).map(r => r.id));
}

// The engine prices no ground transport — rideshare, Mears, town car, port
// transfer. Insights still reports them under Travel, so Actual carried them
// and Forecast did not, biasing every variance upward. The honest fix is to
// carry the user's own recorded actuals: we don't predict your Uber, we just
// stop pretending it costs nothing. Airfare never reaches the app at all
// (the CSV is Disney-only rows by design), so it is out of scope here.
//
// A row with no rule id came from a user override — the engine cannot have
// priced it, so it counts as unmodeled. User truth beats engine silence.
const unmodeledTransport = (expenses, modeledRules) => expenses
  .filter(e => e.category === "transportation" && !modeledRules.has(e.rule))
  .reduce((s, e) => s + Math.abs(e.amount ?? 0), 0);

// Airfare is the one transport kind the engine can never predict: it has no
// idea where a household flies from, and the Disney-only CSV convention
// means a flight only ever arrives if the user deliberately records one.
// So the forecast discloses the omission instead of silently implying $0,
// and the disclaimer drops the moment a real airfare row exists.
export function airTransportRules(prefixes) {
  const rules = prefixes.rules ?? prefixes.prefixes ?? [];
  return new Set(rules.filter(r => r.transport_kind === "air").map(r => r.id));
}

export function forecastTrip(trip, C, year,
  { expenses = [], modeledRules, airRules } = {}) {
  const parts = {};
  const landNights = Array.isArray(trip.lodging_segments)
    ? trip.lodging_segments.reduce((s, seg) => s + (seg.nights ?? 0), 0)
    : trip.nights;

  if (trip.include_parks)
    parts.park = forecastPark(
      trip.include_cruise ? { ...trip, nights: landNights } : trip, C, year);
  if (trip.include_cruise) parts.cruise = forecastCruise(trip, C, year);
  if (trip.include_abd) parts.abd = forecastABD(trip, C, year);

  // carried actuals are exact, not a band — and never make a trip partial
  if (modeledRules) {
    const t = unmodeledTransport(expenses, modeledRules);
    if (t > 0) parts.transport = { total: flat(t), partial: false,
      labels: ["travel from your records"] };
  }

  const airfare = airRules
    && expenses.some(e => e.category === "transportation" && airRules.has(e.rule))
    ? "recorded" : "not_recorded";
  const airLabel = airfare === "not_recorded" ? ["airfare not included"] : [];

  const present = Object.values(parts);
  // No components → no forecast. Never a $0: zero is a claim, absence is not.
  if (!present.length) return { parts, total: null, partial: true, labels: [], airfare };

  const total = present.map(p => p.total).filter(Boolean).reduce(add, zero());
  return {
    parts,
    total,
    airfare,
    // one missing benchmark taints the trip — a partial forecast is not a
    // smaller forecast (INSIGHTS-BUILD §4.3: render "—", not the number)
    partial: present.some(p => p.partial),
    labels: [...new Set([...present.flatMap(p => p.labels ?? []), ...airLabel])],
  };
}

// ---- D. DVC outlook (canonical, no bands) --------------------------------

export function dvcOutlook(contract, C, year) {
  const r = C.dues[contract.resort];
  const dues_pp = r ? esc(r.dues_pp, r.g_resort, year - r.year) : contract.dues_pp;
  const g = r ? r.g_resort : 0.045;
  const years = [0, 1, 2].map(t => ({
    year: year + t,
    dues: contract.points * dues_pp * Math.pow(1 + g, t),
  }));
  return { g_resort: g, dues_pp, years };
}

// Dues rows are DERIVED, never stored — the same law as "balances are
// ledger-derived per contract per use year, never stored" (frozen DVC
// principle). the design director's annual point-chart refresh already carries the dues
// table, so there is no generator and no dvc_dues table: dues are just
// contract points × the published rate.
//
// Opt-out is why the contract carries a tracking WINDOW rather than a
// boolean: the frozen behaviour is "opt-out stops future generation;
// existing rows remain", and a pure derivation off a boolean would erase
// the past too.
export function duesRowsFor(contracts, C, throughYear) {
  const rows = [];
  for (const k of contracts) {
    if (k.track_dues_from == null) continue;          // opt-in only
    const r = C.dues[k.resort];
    if (!r) continue;                                 // no data → no row, ever
    const last = Math.min(k.track_dues_until ?? throughYear, throughYear);
    for (let year = k.track_dues_from; year <= last; year++) {
      const published = r.byYear?.[String(year)];
      const rate = published ?? esc(r.dues_pp, r.g_resort, year - r.year);
      rows.push({
        year,
        contract_id: k.id,
        resort: k.resort,
        amount: k.points_per_year * rate,
        estimated: published == null,
      });
    }
  }
  return rows;
}

// ---- blend + insights ----------------------------------------------------

export function blend(userEstimate, nSameTypeTrips, benchValue) {
  const w = Math.min(1, nSameTypeTrips / 3);
  return w * userEstimate + (1 - w) * benchValue;
}

export function vsTypical(tripActual, C, year) {
  const e = C.byId["insights.family4_week"];
  return tripActual / esc(e.typical, e.drift_rate, ageOf(e, year));
}

// ---- storage row → forecast input (chunk 6) ------------------------------
// The engine and the store disagree on names, and the engine knows nothing
// about the segments table. Left unadapted a stored row STILL forecasts —
// but silently low and NOT partial: kids, hopper, dining and every lodging
// segment drop out while nothing marks the number incomplete. A confident
// wrong number is the one outcome operating rule 5 exists to prevent, so
// this mapping is a tested function, never a spread at the call site.

// Which hotel categories have a cash lodging benchmark.
//
// ⚠ SUPERSEDES the frozen "a cash villa rental is not a modelled product"
// (the design director 2026-08-01). A DVC villa now prices a CASH night at the deluxe band,
// so every resort forecasts a cash stay instead of only Riviera doing it.
//
// It maps to the EXISTING deluxe band rather than a new villa tier, and the
// arithmetic is why: Disney advertises Deluxe Villas from $484 and Deluxe
// Resort Hotels from $345 pre-tax, but this band is TAX-INCLUSIVE and its low
// is 500 — against a taxed villa floor of roughly 484 x 1.125 = 545. Those are
// ~9% apart, not the ~40% the two advertised floors suggest, because 500 was
// never the $345 number. A deluxe studio is the entry point of the villa
// category and the modal DVC cash booking, so the band already covers it.
//
// ON POINTS IS UNCHANGED: `if (seg.on_points) continue` runs before any tier
// lookup, so a points stay is still $0 cash and priced through dues.
//
// Residual, accepted: a one-bedroom or larger villa is underpriced by this,
// since the band is a studio-sized room.
//
// OFF-PROPERTY (2026-08-04) no longer has "no tier". It resolves through the
// hotel row's own `stars` (1-4, set by the user when they name the hotel) to
// its own `offprop.lodging.*` band — never to a Disney one. A hotel saved
// before this shipped has no `stars`, so it still returns null and the trip
// stays partial, which is the correct reading: nobody has said what kind of
// hotel it is, and guessing from the name would be the fake number rule 5
// exists to prevent.
const TIER_BY_CATEGORY = {
  value: "value", moderate: "moderate", deluxe: "deluxe", dvc_villa: "deluxe",
};

// 1-4 only. A star outside the band list resolves to null (partial) rather
// than clamping into the nearest band, so a bad stored value cannot silently
// price a stay at a tier nobody chose.
export const OFFPROP_TIERS = {
  1: "offprop.lodging.star1", 2: "offprop.lodging.star2",
  3: "offprop.lodging.star3", 4: "offprop.lodging.star4",
};
export const tierForHotel = hotel =>
  hotel?.category === "off_property"
    ? (OFFPROP_TIERS[hotel.stars] ?? null)
    : (TIER_BY_CATEGORY[hotel?.category] ?? null);

const nightsBetween = (a, b) =>
  a && b ? Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) : 0;

export function toForecastTrip(row, segments = [], hotels = []) {
  const hotelOf = id => hotels.find(h => h.id === id);
  // Stored segments win when supplied; otherwise honour any lodging_segments
  // the row already carries (the engine-shaped input its own tests use), so
  // adapting a row can only ADD information, never silently drop a stay.
  const source = segments.length ? segments
    : (Array.isArray(row.lodging_segments) ? row.lodging_segments : []);
  const segs = (row.include_lodging === false ? [] : source).map(s => ({
    ...s,
    // an explicit tier is authoritative; derive one only when it is absent
    tier: s.tier ?? tierForHotel(hotelOf(s.hotel_id)),
    on_points: Boolean(s.on_points),
  }));
  const segNights = segs.reduce((n, s) => n + (s.nights ?? 0), 0);
  // INVARIANT: adapting can only ADD information. Every rename falls back to
  // the engine-shaped field, so a row that already speaks the engine dialect
  // passes through untouched instead of being blanked by a missing store name.
  return {
    ...row,
    kids: row.kids_under_7 ?? row.kids ?? 0,
    hopper: Boolean(row.park_hopper ?? row.hopper),
    dining_style: row.dining_profile ?? row.dining_style ?? null,
    check_in: row.check_in ?? row.start_date ?? null,
    // Food is (nights + 1) days, so nights must survive a trip with no lodging
    // segments — a parks-only day trip still eats.
    nights: segNights || row.nights || nightsBetween(row.start_date, row.end_date),
    lodging_segments: segs,
  };
}
