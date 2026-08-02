// The one way a SCREEN forecasts a stored trip.
//
// Why this file exists (2026-08-01). `forecastTrip` takes an options bundle —
// `{ expenses, modeledRules, airRules }` — and every screen assembled it for
// itself. Insights assembled it; Trips and Spend passed `{}`. That is not a
// cosmetic difference: without `modeledRules` the engine drops the frozen
// TRANSPORT CARRY (FORECASTING.md, the design director 2026-07-20), so the same trip
// forecast $12,462 on Trips and Spend and $24,808 on Insights — a gap of
// exactly the stress ledger's $12,345.67 Mears row. Without `airRules` the
// airfare disclosure is stuck on "not_recorded" even after the user records a
// flight, which is the one thing the disclosure exists to stop.
//
// Three copies of an options literal is how the screens drifted, so there is
// now one copy and no literal: a screen hands over what it read from storage
// and cannot forget an argument it never writes. Same move the project already
// made for `js/trip-type.js` and `format.variancePct`.

import {
  compileForecast, forecastTrip, toForecastTrip,
  modeledTransportRules, airTransportRules,
} from "./forecast.js";

// Four datasheets, not three. prefixes.json is the one Trips and Spend never
// loaded — it carries `forecast_modeled` and `transport_kind`, which is where
// both rule sets come from.
export const FORECAST_DATASHEETS = [
  "./data/benchmarks.json",
  "./data/categorizer/fingerprints.json",
  "./data/dvc-canonical.json",
  "./data/categorizer/prefixes.json",
];

// Split from the loader so tests (and any caller that already holds the JSON)
// can build a bundle without a network.
export function makeForecastBundle([benchmarks, fingerprints, canonical, prefixes]) {
  return {
    C: compileForecast(benchmarks, fingerprints, canonical),
    modeledRules: modeledTransportRules(prefixes),
    airRules: airTransportRules(prefixes),
  };
}

// Throws if any datasheet is missing: the caller decides whether that means a
// dead screen or a "—", and all four screens already choose "—".
export async function loadForecastBundle(fetchJSON) {
  const get = fetchJSON ?? (u => fetch(u).then(r => r.ok ? r.json() : Promise.reject(u)));
  return makeForecastBundle(await Promise.all(FORECAST_DATASHEETS.map(get)));
}

// A stored row → the engine's full result, or null when the app has no
// business claiming a number. Returns the WHOLE result rather than a total:
// Trips needs `airfare` and `labels`, Spend and Insights need `total.typical`,
// and narrowing here would push each screen back to calling the engine itself.
//
// `toForecastTrip` is not optional and is applied here so it cannot be
// skipped: a raw storage row still forecasts, but silently low and NOT
// flagged partial, because kids / hopper / dining / lodging all read from
// names the store does not use.
export function forecastFromStore(bundle, row, { segments = [], hotels = [], expenses = [] } = {}) {
  if (!bundle || !row?.start_date) return null;
  return forecastTrip(
    toForecastTrip(row, segments, hotels),
    bundle.C,
    Number(String(row.start_date).slice(0, 4)),
    { expenses, modeledRules: bundle.modeledRules, airRules: bundle.airRules },
  );
}

// The reading every card and tile wants: the typical band value, or null when
// the forecast is partial. A partial forecast is not a smaller forecast —
// operating rule 5 renders "—", never the number missing a term.
export function typicalOrNull(f) {
  return f && f.total && !f.partial ? f.total.typical : null;
}
