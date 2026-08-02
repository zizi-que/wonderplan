// Review-screen category propagation (specs/SPEND-SPEC.md B.3).
// Batch-scoped only: nothing is persisted, so no local rule can ever
// shadow the shipped datasheet.
import { tokenKey } from "../categorizer/normalize.js";

// Rows that matched the same prefixes.json rule are the same merchant by the
// datasheet's own definition. Rows that matched nothing fall back to an
// order-insensitive, truncation-tolerant token-set key. tokenKey() returns a
// sorted array, not a primitive, so it's joined into a comparable string.
function isSibling(a, b) {
  // Manual rows never participate in propagation (specs/SPEND-SPEC.md §D.2):
  // each is hand-entered and owns its own user-picked category. Tapping a
  // manual row changes only that row; a CSV change never sweeps one. Explicit,
  // not relying on the accident that a manual row has no `normalized` key.
  if (a.source === "manual" || b.source === "manual") return false;
  if (a.rule && b.rule) return a.rule === b.rule;
  if (a.rule || b.rule) return false;
  const aKey = [...tokenKey(a.normalized)].sort().join("|");
  const bKey = [...tokenKey(b.normalized)].sort().join("|");
  // An empty key means the descriptor had no token ≥2 chars to key on — it
  // carries no merchant signal, so it must never match anything, including
  // another empty key (two unrelated short-token rows would otherwise be
  // treated as the same merchant and moved together).
  if (aKey === "" || bKey === "") return false;
  return aKey === bKey;
}

// `changed` counts SIBLINGS only, per specs/SPEND-SPEC.md §B.3 ("14 matching
// rows updated" means 14 other rows, not the tapped row itself). The target
// row is always recategorized but never counted.
export function applyCategory(rows, index, category) {
  const target = rows[index];
  let changed = 0;
  const out = rows.map((r, i) => {
    if (i !== index && !isSibling(target, r)) return r;
    if (i !== index) changed++;
    return { ...r, category, category_source: "user" };
  });
  return { rows: out, changed };
}
