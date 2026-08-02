// Workbench orchestrator — ties L1→L2→L4 into the single call the workbench
// UI will use, plus the L4 companions: local override rules (user truth,
// prefix on normalized descriptor), refund pairing, cash imputation (§3.5),
// and the shareable audit report (§3 — rule stats and unmatched descriptors
// only; NO amounts, NO transaction dates).
//
// L3 price fingerprinting is deliberately absent: it reads forecaster
// datasheets, and the logging path must not (Project Memory, Frozen
// Decisions > Architecture, 2026-07-21). Measured cost: zero — L3 matched
// 0 of 367 rows on the real ledger.
//
// Pure module: storage (IndexedDB) and UI live elsewhere.
import { normalizeDescriptor } from "./normalize.js";
import { compileRules, matchMerchant } from "./match.js";

export function compileEngine({ prefixes }) {
  return {
    rules: compileRules(prefixes),
    versions: { prefixes: prefixes.version },
  };
}

// overrides: [{ value: normalized-prefix, category }] — user assignments
export function recordOverride(overrides, normalizedPrefix, category) {
  const value = normalizedPrefix.toUpperCase();
  return [...overrides.filter(o => o.value !== value), { value, category }];
}

export function matchOverride(overrides, normalized) {
  for (const o of overrides) if (normalized.startsWith(o.value)) return o.category;
  return null;
}

export function categorizeRow(row, engine, overrides) {
  const normalized = normalizeDescriptor(row.descriptor ?? row.raw ?? "");
  const base = { date: row.date, amount: row.amount,
    descriptor_raw: row.descriptor ?? row.raw,
    normalized, merchant: null, category: null, confidence: "none",
    evidence: "", via: null, rule: null };

  const ovCat = matchOverride(overrides, normalized);
  if (ovCat) return { ...base, category: ovCat, confidence: "high",
    via: "override", evidence: `your rule: ${normalized.slice(0, 30)} → ${ovCat}` };

  const l2 = matchMerchant(normalized, engine.rules);
  if (l2 && l2.category) return { ...base, merchant: l2.merchant,
    category: l2.category, confidence: l2.confidence,
    evidence: `${l2.merchant} (rule ${l2.rule})`, via: "L2", rule: l2.rule };

  return { ...base, merchant: l2?.merchant ?? null, via: "L4" };
}

const daysBetween = (a, b) =>
  Math.abs(new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000;

export function categorizeRows(rows, engine, overrides) {
  const results = rows.map(r => categorizeRow(r, engine, overrides));
  // refund pairing (§1 L0): a refund copies the category of the purchase it
  // reverses — same |amount| ±$0.01, ≤90 days apart, categorized.
  results.forEach((res, i) => {
    if (!rows[i].refund || res.category) return;
    for (let j = 0; j < results.length; j++) {
      if (j === i || !results[j].category) continue;
      if (Math.abs(Math.abs(results[j].amount) - Math.abs(res.amount)) <= 0.01 &&
          daysBetween(rows[j].date, rows[i].date) <= 90) {
        res.category = results[j].category;
        res.confidence = "med";
        res.via = "refund-pair";
        res.evidence = `refund of ${results[j].descriptor_raw}`;
        break;
      }
    }
  });
  const counters = {}, unmatched = {};
  for (const r of results) {
    if (r.rule && r.category) recordCorrection(counters, r.rule, true);
    if (!r.category) unmatched[r.normalized] = (unmatched[r.normalized] || 0) + 1;
  }
  return { results, counters, unmatched };
}

// ---- cash imputation (§3.5): one cash row → proportional 3-way split -----

const CASH_POOL = ["food", "activity", "gifts"];

export function imputeCash(amount, tripTotals, householdTotals) {
  const totals = pickTotals(tripTotals) ?? pickTotals(householdTotals);
  const shares = totals
    ? CASH_POOL.map(c => totals[c] / CASH_POOL.reduce((s, k) => s + totals[k], 0))
    : [1 / 3, 1 / 3, 1 / 3];
  const split = CASH_POOL.map((c, i) => ({
    category: c, share: shares[i],
    amount: Math.round(amount * shares[i] * 100) / 100,
    imputed: true, basis: totals ? "trip-proportions" : "equal-thirds",
  }));
  // cents drift goes to the last slice so the sum is exact
  const drift = amount - split.reduce((s, x) => s + x.amount, 0);
  split[2].amount = Math.round((split[2].amount + drift) * 100) / 100;
  return split;
}

function pickTotals(t) {
  if (!t) return null;
  const sum = CASH_POOL.reduce((s, k) => s + (t[k] || 0), 0);
  return sum > 0 ? { food: t.food || 0, activity: t.activity || 0, gifts: t.gifts || 0 } : null;
}

// ---- audit loop (§3) -----------------------------------------------------

export function recordCorrection(counters, ruleId, wasAuto) {
  const c = (counters[ruleId] ||= { auto: 0, corrected: 0 });
  if (wasAuto) c.auto++; else c.corrected++;
}

// Shareable by construction: rule ids, hit/correction counts, unmatched
// normalized descriptors, datasheet versions. Nothing financial.
export function buildAuditReport({ counters, unmatched, versions }) {
  return {
    datasheets: versions,
    rules: Object.entries(counters).map(([id, c]) => ({
      id, auto: c.auto, corrected: c.corrected,
      correction_rate: c.auto + c.corrected ? c.corrected / (c.auto + c.corrected) : 0,
    })).sort((a, b) => b.correction_rate - a.correction_rate),
    uncategorized: Object.entries(unmatched)
      .sort((a, b) => b[1] - a[1])
      .map(([descriptor, count]) => ({ descriptor, count })),
  };
}
