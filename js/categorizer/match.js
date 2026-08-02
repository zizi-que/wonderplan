// L2 — merchant match against the prefix datasheet
// (specs/SPEND-CATEGORIZATION.md §1 L2). Pure; rules injected, not imported,
// so browser and tests load data/categorizer/prefixes.json their own way.
import { tokenKey, tokenSimilarity } from "./normalize.js";

const TOKEN_SIM_THRESHOLD = 0.7; // truncation fallback bar (tested in suite)

// Precompute matching structures once per datasheet load.
export function compileRules(datasheet) {
  const rules = datasheet.rules.map(r => ({
    ...r,
    value: r.match.value.toUpperCase(),
    tokens: tokenKey(r.match.value.toUpperCase()),
  }));
  // longest value first so prefix matching is longest-match by construction
  const prefixes = rules
    .filter(r => r.match.type === "prefix" || r.match.type === "exact")
    .sort((a, b) => b.value.length - a.value.length);
  const tokenRules = rules.filter(r => r.match.type === "token");
  return { prefixes, tokenRules, version: datasheet.version };
}

// normalized: output of normalizeDescriptor(). Returns null or
// { rule, category, confidence } — category may be null (venue-only rule:
// merchant identified, category deferred to L3/L4).
export function matchMerchant(normalized, compiled) {
  // Pass 1+2: rules that actually categorize. Venue-only rules (category
  // null, e.g. bare "WDW") must NOT shadow a more specific token rule
  // ("WDW BAYVIEW GIFTS" ⊃ token "BAYVIEW GIFTS") — they run in pass 3.
  for (const r of compiled.prefixes) {
    if (r.category == null) continue;
    if (r.match.type === "exact" ? normalized === r.value : normalized.startsWith(r.value)) {
      return hit(r, "exact-prefix");
    }
  }
  // token rules: the rule's tokens must appear in the descriptor (any order,
  // e.g. "SQ *3003 - JOFFREY'S COFF" vs token rule "JOFFREY'S COFF")
  for (const r of compiled.tokenRules) {
    if (r.category != null && r.tokens.every(t => normalized.includes(t))) return hit(r, "token");
  }
  // Pass 3: venue-only identification (merchant known, category deferred)
  for (const r of compiled.prefixes) {
    if (r.category != null) continue;
    if (r.match.type === "exact" ? normalized === r.value : normalized.startsWith(r.value)) {
      return hit(r, "exact-prefix");
    }
  }
  for (const r of compiled.tokenRules) {
    if (r.category == null && r.tokens.every(t => normalized.includes(t))) return hit(r, "token");
  }
  // truncation fallback: bank cut the descriptor mid-word
  const descTokens = tokenKey(normalized);
  let best = null, bestSim = 0;
  for (const r of [...compiled.prefixes, ...compiled.tokenRules]) {
    const sim = tokenSimilarity(descTokens, r.tokens);
    if (sim > bestSim) { bestSim = sim; best = r; }
  }
  if (best && bestSim >= TOKEN_SIM_THRESHOLD) return hit(best, "similarity");
  return null;
}

function hit(rule, via) {
  return {
    rule: rule.id,
    merchant: rule.merchant,
    venue: rule.venue,
    category: rule.category,
    // venue-only or declared-ambiguous rules are never high on their own
    confidence: rule.category == null ? "none" : rule.ambiguous ? "med" : "high",
    folio: rule.folio === true,
    transport_kind: rule.transport_kind ?? null,
    via,
  };
}
