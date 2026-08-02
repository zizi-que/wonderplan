// Shared display formatting — INSIGHTS-BUILD §5.1.
// App-wide, not Insights-local: any count rendered anywhere goes through
// plural() so "1 trip" / "2 trips" never has to be re-solved per screen.
// Pure functions, no DOM.

// Superlative headers ("Most Trips") are fixed strings, NOT plural() calls —
// a value of 1 must not turn them singular.
export function plural(n, unit, pluralForm) {
  const word = n === 1 ? unit : (pluralForm ?? `${unit}s`);
  return `${n} ${word}`;
}

// Whole dollars — the app is USD-only and Insights never shows cents
// (INSIGHTS-SPEC: "Numbers stay in dollars").
// null/undefined mean "no value", which must render as the honest em-dash.
// Never coerce a missing number to $0 — that is the fake-number failure the
// forecast engine is built to avoid.
export function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// Variance = actual as a SHARE OF FORECAST, in whole percent. 100 is on
// forecast; above it is overspend. Rendered as a percentage on both Spend and
// Insights (the design director, 2026-07-28 — Spend used to show a signed dollar gap), so
// the definition lives here rather than once per screen: the two tiles carry
// the same word and must not answer differently.
// null whenever the forecast is null, zero or partial — a share of an unknown
// is not 0%, and operating rule 5 forbids inventing the number. Callers render
// the em-dash, as they already do for a missing forecast.
export function variancePct(actual, forecast) {
  if (forecast == null || !(forecast > 0)) return null;
  return Math.round((actual ?? 0) / forecast * 100);
}
