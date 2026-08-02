// L3 — price-fingerprint arithmetic (specs/SPEND-CATEGORIZATION.md §1 L3).
// NOT WIRED INTO THE LOGGING PATH (2026-07-21). This module reads forecaster
// datasheets (benchmarks.json, fingerprints.json), and the Spend logging path
// must not — see Project Memory, Frozen Decisions > Architecture. Kept on
// disk with its tests because the research behind it stands and the
// forecaster may use it. Do not re-import it from engine.js.
// Pure; datasheets injected like match.js. Implemented classes:
//   F1  exact-price products (±tolerance): amount = p, p × payers, p × payers × nights
//   F2  ticket day-curve solve (the design director model 2026-07-19): the per-day price
//       declines with ticket length; solve day-count d from
//       amount ≈ (adults + kids×child_factor) × T(d) using the esc()-aged
//       benchmark band as the variance approximation. Pre-trip only.
//       Solved d cross-checks trip park_days. (DVC point-calendar demand
//       index in data/dvc-canonical.json is the date-trend proxy for the
//       next tightening pass — v1 uses full-band membership.)
//   F3  band + timing: per-night rate inside an esc()-aged lodging band,
//       charged pre-trip or in the checkout settlement window → lodging (med)
//   folio-mixture flag (§3.6): folio venue + amount > party × QS-high × 2

const POSTING_LAG_DAYS = 6; // §3.6: card posting lags +2..+6d after checkout

export function compileFingerprints(fingerprints, benchmarks) {
  const qs = benchmarks.entries.find(e => e.id === "park.food_per_diem.adult.qs");
  const cf = benchmarks.entries.find(e => e.id === "park.ticket.child_factor");
  const ticketCurve = [];
  for (const e of benchmarks.entries) {
    if (e.metric === "ticket_multiday_total" || e.id === "park.ticket.1day.adult") {
      if (e.dims.age !== "10+" || e.dims.hopper) continue;
      ticketCurve.push({ days: e.dims.days, low: e.low, high: e.high,
        drift: e.drift_rate, year: e.effective_year });
    }
  }
  ticketCurve.sort((a, b) => a.days - b.days);
  return {
    products: fingerprints.products,
    lodgingBands: benchmarks.entries.filter(e => e.metric === "lodging_night"),
    ticketCurve,
    childFactor: cf ? cf.typical : 1,
    qsHigh: qs.high,
    qsDrift: qs.drift_rate,
    qsYear: qs.effective_year,
  };
}

// FORECASTING.md §1: esc(x) = x × (1 + g)^age — age may be negative (past rows)
const esc = (x, g, age) => x * Math.pow(1 + g, age);
const yearOf = iso => Number(iso.slice(0, 4));
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// row: { amount, date }  trip: { party, adults?, kids?, nights, check_in,
// check_out, cruise_nights? }  l2: matchMerchant() result or null.
// Returns null or { class, category, confidence, evidence, product?, flag? }.
export function matchFingerprint(row, trip, compiled, l2) {
  // gating: a confident, unambiguous L2 assignment is final — L3 only refines
  // ambiguous or venue-only hits, or runs where L2 found nothing.
  if (l2 && l2.category != null && !l2.ambiguous) return null;

  const f1 = matchExactProduct(row, trip, compiled);
  if (f1) return f1;

  // folio venues: settlement mega-rows are mixtures — flag, never categorize
  if (l2 && l2.folio) {
    const age = yearOf(row.date) - compiled.qsYear;
    const threshold = trip.party * esc(compiled.qsHigh, compiled.qsDrift, age) * 2;
    if (Math.abs(row.amount) > threshold) {
      return {
        class: "F3", flag: "folio-mixture", category: null, confidence: "none",
        evidence: `$${row.amount} > ${trip.party} guests × QS-high × 2 (≈$${threshold.toFixed(0)}) — folio settlement mixture, excluded from unit costs`,
      };
    }
    return null; // plausible single receipt on a folio venue stays honest L4
  }

  // F2 runs where L2 found nothing or only a venue (category null, non-folio);
  // F3 bands only apply to descriptors L2 could not identify at all — a known
  // POS venue (even category-deferred) is a purchase, not a room charge.
  const f2 = matchTicketCurve(row, trip, compiled);
  const f3 = l2 ? null : matchLodgingBand(row, trip, compiled);
  // both band classes claiming different categories = genuine ambiguity.
  // Tiebreak: the trip form's park_days confirming a solved ticket length is
  // real trip-context evidence — F2 wins. Otherwise guessing is worse than an
  // honest Uncategorized (same law as forecasting).
  if (f2 && f3) {
    if (trip.park_days != null && f2.solved.includes(trip.park_days)) return f2;
    return {
      class: "F2×F3", flag: "ambiguous-band", category: null, confidence: "none",
      evidence: `both fingerprints fit: ${f2.evidence} AND ${f3.evidence}`,
    };
  }
  return f2 || f3;
}

// F2 — solve ticket length from the party-scaled, esc()-aged day-curve bands.
function matchTicketCurve(row, trip, compiled) {
  if (!trip.check_in || row.date >= trip.check_in) return null; // pre-trip only
  const kids = trip.kids ?? 0;
  const scale = trip.adults != null
    ? trip.adults + kids * compiled.childFactor
    : trip.party;
  if (!(scale >= 1)) return null;
  const amount = Math.abs(row.amount);
  const solved = [];
  for (const t of compiled.ticketCurve) {
    const age = yearOf(row.date) - t.year;
    const low = esc(t.low, t.drift, age) * scale;
    const high = esc(t.high, t.drift, age) * scale;
    if (amount >= low && amount <= high) solved.push(t.days);
  }
  if (!solved.length) return null;
  const span = solved.length === 1 ? `${solved[0]}` : `${solved[0]}–${solved[solved.length - 1]}`;
  let crossCheck = "";
  if (trip.park_days != null) {
    crossCheck = solved.includes(trip.park_days)
      ? `; matches park_days ${trip.park_days}`
      : `; park_days ${trip.park_days} mismatch — check ticket length`;
  }
  return {
    class: "F2", category: "activity", confidence: "med", solved,
    evidence: `≈ ${scale.toFixed(2)}× adult ${span}-day ticket band (esc-aged, pre-trip)${crossCheck}`,
  };
}

function matchExactProduct(row, trip, compiled) {
  const amount = Math.abs(row.amount);
  for (const p of compiled.products) {
    const tol = p.tolerance_usd ?? 0.01;
    for (const { mult, desc } of multipliers(p, trip)) {
      if (Math.abs(amount - p.price * mult) <= tol) {
        return {
          class: "F1", product: p.id, category: p.category, confidence: "high",
          evidence: `= $${p.price}${desc} (${p.label})`,
        };
      }
    }
  }
  return null;
}

// Candidate payer×night combinations for a product, from trip context.
function multipliers(p, trip) {
  if (!p.party) return [{ mult: 1, desc: "" }];
  const payers = new Set([trip.party]);
  // kids-free products (e.g. 2026 dining plan): adults-only payer count
  if (trip.adults != null) payers.add(trip.adults);
  const nights = p.per_night
    ? [...new Set([trip.nights, trip.cruise_nights].filter(n => n >= 1))]
    : [1];
  const out = [];
  for (const g of payers) {
    if (!(g >= 1)) continue;
    for (const n of nights) {
      out.push({
        mult: g * n,
        desc: p.per_night ? ` × ${g} guests × ${n} nights` : ` × ${g} guests`,
      });
    }
  }
  return out;
}

function matchLodgingBand(row, trip, compiled) {
  if (!(trip.nights >= 1) || !trip.check_in || !trip.check_out) return null;
  const preTrip = row.date < trip.check_in;
  const settlement =
    row.date >= addDays(trip.check_out, -1) &&
    row.date <= addDays(trip.check_out, POSTING_LAG_DAYS);
  if (!preTrip && !settlement) return null; // timing gate first — never in-trip

  const rate = Math.abs(row.amount) / trip.nights;
  for (const band of compiled.lodgingBands) {
    const age = yearOf(row.date) - band.effective_year;
    const low = esc(band.low, band.drift_rate, age);
    const high = esc(band.high, band.drift_rate, age);
    if (rate >= low && rate <= high) {
      return {
        class: "F3", category: "lodging", confidence: "med",
        evidence: `≈ $${rate.toFixed(0)}/night × ${trip.nights} nights in ${band.dims.tier} band, charged ${preTrip ? "pre-trip" : "at checkout settlement"}`,
      };
    }
  }
  return null;
}
