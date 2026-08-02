// L1 — descriptor normalization: strip bank grammar, keep merchant signal.
// (specs/SPEND-CATEGORIZATION.md §1 L1). Order matters; every step is a pure
// string transform. Evidence must always cite the RAW string — callers keep it.

// Payment-processor wrappers seen at the start of descriptors.
const WRAPPERS = [
  /^TST[*\s]+/,          // Toast POS
  /^SQ\s*\*\s*/,         // Square
  /^PAYPAL\s*\*\s*/, /^PP\*\s*/,
  /^APLPAY\s+/, /^APPLE\s*PAY\s+/,
  /^GOOGLE\s*\*\s*/,
  /^DD\s*\*\s*/,         // DoorDash-delivered (still the merchant's category)
  /^CKE\*\s*/, /^IC\*\s*/,
];

const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

const NOISE = [
  /_\d+OF\d+\b/g,                        // folio split-settlement marker (_1of2)
  /\bX{2,}[-\s]?\d{3,4}\b/g,             // card fragments XXXX-1234
  /#\s?\d{2,6}\b/g,                      // store numbers #1234
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,    // phone numbers
  /\b\d{10,}\b/g,                        // long reference/reservation codes
  /\bWWW\.[A-Z0-9.-]+\b/g, /\b[A-Z0-9-]+\.COM\b/g, // URLs-as-city
];

// Trailing geo: state token + at most ONE city word before it. MINIMAL strip
// by design — multi-word cities ("LK BUENA VIS") leave fragments, which L2's
// longest-prefix match ignores; greedy stripping once ate real merchant words
// ("ONBOARD CELEBRATION FL"), and over-stripping is the dangerous direction.
// Per-bank city patterns belong in banks.json, not here.
const CITY_STATE = new RegExp(
  `(?:\\s+[A-Z][A-Z.]{1,14})?\\s+(?:${US_STATES})\\s*$`
);

export function normalizeDescriptor(raw) {
  let s = String(raw).toUpperCase();
  s = s.replace(/\s+/g, " ").trim();
  for (const re of WRAPPERS) s = s.replace(re, "");
  for (const re of NOISE) s = s.replace(re, " ");
  s = s.replace(/\s+/g, " ").trim();
  const beforeGeo = s;
  s = s.replace(CITY_STATE, "").trim();
  // Geo-stripping must leave a recognizable merchant (≥2 tokens); otherwise
  // revert — "ORLANDO FL" stays whole, and a one-word merchant keeps its city
  // (safe side: L2 token similarity still matches it).
  if (s.split(" ").filter(t => t.length >= 2).length < 2) s = beforeGeo;
  s = s.replace(/[*]+$/g, "").replace(/\s+/g, " ").trim();
  return s;
}

// Token-set key: order-insensitive, truncation-tolerant fallback for L2.
// "WDW MK PARKS MER" (25-char cut) still shares tokens with the full rule.
export function tokenKey(normalized) {
  return [...new Set(normalized.split(" ").filter(t => t.length >= 2))].sort();
}

// Jaccard similarity between token sets — L2's fuzzy fallback when exact
// prefix fails (banks that truncate). Threshold decision lives in the
// datasheet, not here.
export function tokenSimilarity(aTokens, bTokens) {
  const A = new Set(aTokens), B = new Set(bTokens);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // Truncation-aware: also credit prefix-token matches (MER ~ MERCH).
  for (const t of A) if (!B.has(t)) for (const u of B) {
    if (u.startsWith(t) || t.startsWith(u)) { inter += 0.5; break; }
  }
  const union = A.size + B.size - Math.min(inter, Math.min(A.size, B.size));
  return union === 0 ? 0 : inter / union;
}
